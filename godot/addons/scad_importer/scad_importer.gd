@tool
extends EditorSceneFormatImporter

func _get_extensions():
	return PackedStringArray(["scad"])

func _get_import_flags():
	return EditorSceneFormatImporter.IMPORT_SCENE

func _import_scene(path: String, flags: int, options: Dictionary) -> Object:
	var global_source = ProjectSettings.globalize_path(path)
	var unique_id = str(hash(path))
	var temp_glb_path = ProjectSettings.globalize_path("user://scad_cache_" + unique_id + ".glb")

	var args = PackedStringArray()
	args.append("convert")
	args.append(global_source)
	args.append(temp_glb_path)

	var output = []
	print("Importing %s via scad-gltf..." % path.get_file())

	var exit_code = -1
	if OS.get_name() == "Windows":
		var win_args = PackedStringArray(["/c", "scad-gltf"])
		win_args.append_array(args)
		exit_code = OS.execute("cmd.exe", win_args, output, true)
	else:
		exit_code = OS.execute("scad-gltf", args, output, true)

	if exit_code != 0:
		push_error(Failed to compile SCAD file: %s. Ensure scad-gltf is installed." % path.get_file())
		push_error("scad-gltf convert output: ", "\n".join(output))
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

	return generated_scene
