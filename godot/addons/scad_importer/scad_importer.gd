# Copyright (c) 2026 Ilia Grigorev. Distributed under the MIT License.
# See LICENSE in the addon directory for details.

@tool
extends EditorSceneFormatImporter

var _is_prompting_install = false

func _get_extensions():
	return PackedStringArray(["scad"])

func _get_import_flags():
	return EditorSceneFormatImporter.IMPORT_SCENE

func _import_scene(path: String, flags: int, options: Dictionary) -> Object:
	var global_source = ProjectSettings.globalize_path(path)
	var unique_id = str(hash(path))
	var temp_glb_path = ProjectSettings.globalize_path("user://scad_cache_" + unique_id + ".glb")

	var args = PackedStringArray()
	args.append(global_source)
	args.append(temp_glb_path)

	var output = []
	print("Importing %s via scad-convert..." % path.get_file())

	var exit_code = -1
	if OS.get_name() == "Windows":
		var win_args = PackedStringArray(["/c", "scad-convert"])
		win_args.append_array(args)
		exit_code = OS.execute("cmd.exe", win_args, output, true)
	else:
		exit_code = OS.execute("scad-convert", args, output, true)

	if exit_code != 0:
		print("scad-convert conversion failed for %s. Attempting fallback to local scad-serve..." % path.get_file())
		var fallback_success = _try_scad_serve_fallback(global_source, temp_glb_path)

		if not fallback_success:
			push_error("Failed to compile SCAD file: %s. Ensure Node.js is installed or scad-serve is running." % path.get_file())
			push_error("scad-convert output: ", "\n".join(output))
			call_deferred("_prompt_install", path)
			return null

	var gltf_doc = GLTFDocument.new()
	var gltf_state = GLTFState.new()
	var err = gltf_doc.append_from_file(temp_glb_path, gltf_state)

	if FileAccess.file_exists(temp_glb_path):
		DirAccess.remove_absolute(temp_glb_path)

	if err != OK:
		push_error("Failed to parse the generated GLB for %s." % path.get_file())
		return null

	var generated_scene = gltf_doc.generate_scene(gltf_state)
	if generated_scene:
		generated_scene.name = path.get_file().get_basename()

	# Godot's scene import pipeline takes ownership over the generated node!
	# It will automatically extract ImporterMeshInstance3D nodes and hook it into Advanced Scene Import.
	return generated_scene

func _get_relative_path(base: String, target: String) -> String:
	var base_parts = base.replace("\\", "/").split("/", false)
	var target_parts = target.replace("\\", "/").split("/", false)

	# If on Windows and drive letters are different, relative paths cannot be resolved
	if OS.get_name() == "Windows":
		if base_parts.size() > 0 and target_parts.size() > 0:
			if base_parts[0].nocasecmp_to(target_parts[0]) != 0:
				return target

	var common_count = 0
	var min_len = min(base_parts.size(), target_parts.size())
	for i in range(min_len):
		# Case-insensitive comparison for cross-platform compatibility
		if base_parts[i].nocasecmp_to(target_parts[i]) == 0:
			common_count += 1
		else:
			break

	var rel_parts = PackedStringArray()
	for i in range(common_count, base_parts.size()):
		rel_parts.append("..")

	for i in range(common_count, target_parts.size()):
		rel_parts.append(target_parts[i])

	return "/".join(rel_parts)

func _get_dependencies_recursive(file_path: String, visited: Dictionary) -> void:
	if visited.has(file_path):
		return

	visited[file_path] = ""

	if not FileAccess.file_exists(file_path):
		return

	var file = FileAccess.open(file_path, FileAccess.READ)
	if not file:
		return

	var content = file.get_as_text()
	file.close()

	visited[file_path] = content

	var regex = RegEx.new()
	regex.compile("(?:include|use)\\s*[<\"]([^>\"]+)[>\"]")

	var base_dir = file_path.get_base_dir()
	for result in regex.search_all(content):
		var dep_rel_path = result.get_string(1)
		var dep_abs_path = base_dir.path_join(dep_rel_path).simplify_path()
		_get_dependencies_recursive(dep_abs_path, visited)

func _get_dependencies(file_path: String) -> Dictionary:
	var visited = {}
	_get_dependencies_recursive(file_path, visited)
	return visited

func _try_scad_serve_fallback(source_path: String, out_glb_path: String) -> bool:
	var deps = _get_dependencies(source_path)
	var content = deps.get(source_path, "")
	deps.erase(source_path)

	if content == "":
		return false

	var additional_files = {}
	var base_dir = source_path.get_base_dir()
	for dep_path in deps.keys():
		var rel_path = _get_relative_path(base_dir, dep_path)
		additional_files[rel_path] = deps[dep_path]

	var http = HTTPClient.new()
	var err = http.connect_to_host("127.0.0.1", 3000)
	if err != OK:
		return false

	# Wait for connection (up to 5 seconds)
	var max_wait = 500
	var wait = 0
	while http.get_status() in [HTTPClient.STATUS_CONNECTING, HTTPClient.STATUS_RESOLVING]:
		http.poll()
		OS.delay_msec(10)
		wait += 1
		if wait > max_wait:
			return false

	if http.get_status() != HTTPClient.STATUS_CONNECTED:
		return false

	var headers = PackedStringArray(["Content-Type: application/json"])

	# Pack the content and dependencies inside options object
	var payload = {
		"content": content,
		"options": {
			"additionalFiles": additional_files
		}
	}

	var body = JSON.stringify(payload)
	err = http.request(HTTPClient.METHOD_POST, "/api/convert", headers, body)
	if err != OK:
		return false

	# Wait for request to process (up to 60 seconds)
	max_wait = 6000
	wait = 0
	while http.get_status() == HTTPClient.STATUS_REQUESTING:
		http.poll()
		OS.delay_msec(10)
		wait += 1
		if wait > max_wait:
			return false

	if http.has_response() and http.get_response_code() == 200:
		var rb = PackedByteArray()
		while http.get_status() == HTTPClient.STATUS_BODY:
			http.poll()
			var chunk = http.read_response_body_chunk()
			if chunk.size() == 0:
				OS.delay_msec(10)
			else:
				rb.append_array(chunk)

		if rb.is_empty():
			return false

		var out_file = FileAccess.open(out_glb_path, FileAccess.WRITE)
		if not out_file:
			return false
		out_file.store_buffer(rb)
		out_file.close()

		print("Successfully compiled %s using scad-serve fallback." % source_path.get_file())
		return true

	return false

func _prompt_install(res_path: String) -> void:
	if _is_prompting_install:
		return
	_is_prompting_install = true

	var dialog = ConfirmationDialog.new()
	dialog.title = "scad-gltf Not Found"
	dialog.dialog_text = "Failed to compile SCAD file.\nNeither scad-convert nor scad-serve could be reached.\n\nWould you like to attempt to install scad-gltf globally via npm?\n(Requires Node.js)"

	dialog.confirmed.connect(func():
		_is_prompting_install = false
		dialog.queue_free()

		var wait_dialog = AcceptDialog.new()
		wait_dialog.title = "Installing..."
		wait_dialog.dialog_text = "Installing scad-gltf globally.\nThe editor will freeze for a moment. Please wait..."
		wait_dialog.get_ok_button().hide()
		EditorInterface.get_base_control().add_child(wait_dialog)
		wait_dialog.popup_centered()

		# Force a draw of the wait dialog before blocking the thread
		await EditorInterface.get_base_control().get_tree().process_frame
		await EditorInterface.get_base_control().get_tree().process_frame

		_execute_install(res_path)
		wait_dialog.queue_free()
	)

	var on_cancel = func():
		_is_prompting_install = false
		dialog.queue_free()

	dialog.canceled.connect(on_cancel)
	dialog.close_requested.connect(on_cancel)

	EditorInterface.get_base_control().add_child(dialog)
	dialog.popup_centered()

func _execute_install(res_path: String) -> void:
	print("Attempting to install scad-gltf via npm...")
	var output = []
	var exit_code = -1
	if OS.get_name() == "Windows":
		exit_code = OS.execute("cmd.exe", PackedStringArray(["/c", "npm", "install", "-g", "scad-gltf"]), output, true)
	else:
		exit_code = OS.execute("npm", PackedStringArray(["install", "-g", "scad-gltf"]), output, true)

	if exit_code == 0:
		print("scad-gltf installed successfully. Reimporting...")
		EditorInterface.get_resource_filesystem().reimport_files(PackedStringArray([res_path]))
	else:
		var err_msg = "\n".join(output)
		push_error("Failed to install scad-gltf. npm output:\n" + err_msg)
		OS.alert("Failed to install scad-gltf.\nEnsure Node.js and npm are installed and in your PATH.\nAlternatively, run 'npm install -g scad-gltf' manually.", "Installation Failed")
