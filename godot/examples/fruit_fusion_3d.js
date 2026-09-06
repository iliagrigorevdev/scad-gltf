#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const PROJECT_DIR = "fruit_fusion_3d";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(relPath, content) {
  const fullPath = path.join(PROJECT_DIR, relPath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, "utf8");
  console.log(`[Created] ${relPath}`);
}

console.log(`Setting up project in ./${PROJECT_DIR}...`);

// ==========================================
// 1. ADDON FILES
// ==========================================

writeFile(
  "addons/scad_importer/plugin.cfg",
  `[plugin]

name="OpenSCAD GLTF Importer"
description="Imports .scad files directly as 3D scenes using scad-gltf"
author="Ilia Grigorev"
version="0.1"
script="scad_plugin.gd"
`,
);

writeFile(
  "addons/scad_importer/scad_plugin.gd",
  `@tool
extends EditorPlugin

var import_plugin

func _enter_tree():
	import_plugin = preload("res://addons/scad_importer/scad_importer.gd").new()
	add_scene_format_importer_plugin(import_plugin)

func _exit_tree():
	remove_scene_format_importer_plugin(import_plugin)
	import_plugin = null
`,
);

writeFile(
  "addons/scad_importer/scad_importer.gd",
  `@tool
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
	args.append(global_source)
	args.append(temp_glb_path)

	var output = []
	print("Importing %s via scad-convert... (This might take a few seconds on the first run)" % path.get_file())

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
			push_error("scad-convert output: ", "\\n".join(output))
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

func _get_relative_path(base: String, target: String) -> String:
	var base_parts = base.replace("\\\\", "/").split("/", false)
	var target_parts = target.replace("\\\\", "/").split("/", false)

	if OS.get_name() == "Windows":
		if base_parts.size() > 0 and target_parts.size() > 0:
			if base_parts[0].nocasecmp_to(target_parts[0]) != 0:
				return target

	var common_count = 0
	var min_len = min(base_parts.size(), target_parts.size())
	for i in range(min_len):
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
	regex.compile("(?:include|use)\\\\s*[<\\"]([^>\\"]+)[>\\"]")

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
`,
);

// ==========================================
// 2. PROCEDURAL 3D ASSETS (.scad)
// ==========================================

// Container Glass Box with Wooden Border and Danger Marker
writeFile(
  "assets/models/container.scad",
  `$fn = 28;
$asa = 45;

box_w = 12.0;
box_d = 4.0;
box_h = 16.0;
wall_t = 0.2;

// Left, Right & Back Transparent Glass (alpha=0.15 triggers glTF BLEND transparency mode)
color([0.80, 0.93, 1.0], alpha=0.15, transmission=0.92, roughness=0.04, ior=1.52, thickness=0.2, $asa=45) {
    // Back glass plate
    translate([0, box_d/2 + wall_t/2, box_h/2])
        cube([box_w, wall_t, box_h], center=true);

    // Left glass plate
    translate([-box_w/2 - wall_t/2, 0, box_h/2])
        cube([wall_t, box_d, box_h], center=true);

    // Right glass plate
    translate([box_w/2 + wall_t/2, 0, box_h/2])
        cube([wall_t, box_d, box_h], center=true);
}

// Sturdy Polished Wooden Base
color([0.55, 0.32, 0.16], roughness=0.75, clearcoat=0.3) {
    translate([0, 0, -0.4])
        cube([box_w + 1.6, box_d + 1.6, 0.8], center=true);
}

// Metallic Corner Columns & Base Trim
color([0.85, 0.88, 0.92], metalness=0.9, roughness=0.2) {
    for (sx = [-1, 1]) {
        for (sy = [-1, 1]) {
            translate([sx * (box_w/2 + wall_t), sy * (box_d/2 + wall_t), box_h/2])
                cylinder(r=0.22, h=box_h, center=true);
        }
    }
    // Sleek metallic floor plate
    translate([0, 0, 0.05])
        cube([box_w, box_d, 0.1], center=true);
}
`,
);

// Cute Dropper / Aiming Cloud
writeFile(
  "assets/models/dropper.scad",
  `$fn = 24;
$asa = 45;

color([0.98, 0.98, 1.0], roughness=0.4, clearcoat=0.5) {
    translate([0, 0, 0]) sphere(r=0.9);
    translate([-0.8, 0, -0.15]) sphere(r=0.65);
    translate([0.8, 0, -0.15]) sphere(r=0.65);
    translate([-1.4, 0, -0.3]) sphere(r=0.45);
    translate([1.4, 0, -0.3]) sphere(r=0.45);
}

color([1.0, 0.45, 0.55], emissive=[0.8, 0.2, 0.3], emissiveIntensity=0.8, roughness=0.5) {
    translate([-0.65, 0.55, -0.2]) sphere(r=0.18);
    translate([0.65, 0.55, -0.2]) sphere(r=0.18);
}

color([1.0, 0.85, 0.1], emissive=[1.0, 0.7, 0.0], emissiveIntensity=1.8, metalness=0.3, roughness=0.3) {
    translate([0, 0, -0.95])
        cylinder(r1=0.25, r2=0.02, h=0.5, center=true);
}
`,
);

// Tier 1: Cherry
writeFile(
  "assets/models/fruit_1.scad",
  `$fn = 26;
$asa = 45;
r = 0.55;

color([0.85, 0.05, 0.15], roughness=0.15, clearcoat=0.8, clearcoatRoughness=0.1) {
    sphere(r=r);
}

color([0.25, 0.65, 0.15], roughness=0.6) {
    translate([0, 0, r * 0.9])
        cylinder(r=0.08, h=0.12, center=true);
    translate([0.05, 0, r + 0.25])
        rotate([0, 15, 0])
        cylinder(r=0.04, h=0.5, center=true);
    translate([0.18, 0, r + 0.35])
        rotate([0, 45, 10])
        cube([0.22, 0.1, 0.04], center=true);
}
`,
);

// Tier 2: Strawberry
writeFile(
  "assets/models/fruit_2.scad",
  `$fn = 26;
$asa = 45;

color([0.95, 0.12, 0.28], roughness=0.3, clearcoat=0.4) {
    scale([1.0, 1.0, 1.25])
        sphere(r=0.72);
}

color([0.18, 0.75, 0.2], roughness=0.5) {
    for (i = [0:5]) {
        rotate([0, 0, i * 60])
            translate([0.35, 0, 0.82])
            rotate([0, -25, 0])
            cube([0.35, 0.14, 0.05], center=true);
    }
    translate([0, 0, 0.98])
        cylinder(r=0.06, h=0.25, center=true);
}

color([1.0, 0.9, 0.3], roughness=0.4) {
    for (a = [0:5]) {
        rotate([0, 0, a * 60 + 30])
            translate([0.65, 0, 0.1])
            sphere(r=0.05);
        rotate([0, 0, a * 60])
            translate([0.5, 0, -0.4])
            sphere(r=0.045);
    }
}
`,
);

// Tier 3: Grape
writeFile(
  "assets/models/fruit_3.scad",
  `$fn = 28;
$asa = 45;
r = 0.98;

color([0.48, 0.12, 0.68], roughness=0.2, clearcoat=0.6, sheen=0.8, sheenColor=[0.8, 0.4, 0.9]) {
    sphere(r=r);
}

color([0.3, 0.65, 0.2], roughness=0.6) {
    translate([0, 0, r + 0.15])
        cylinder(r=0.07, h=0.35, center=true);
    translate([0.22, 0, r + 0.15])
        rotate([15, -20, 30])
        cube([0.35, 0.25, 0.04], center=true);
}
`,
);

// Tier 4: Orange / Tangerine
writeFile(
  "assets/models/fruit_4.scad",
  `$fn = 28;
$asa = 45;
r = 1.3;

color([1.0, 0.48, 0.02], roughness=0.45, clearcoat=0.3) {
    scale([1.0, 1.0, 0.92])
        sphere(r=r);
}

color([0.2, 0.55, 0.15], roughness=0.6) {
    translate([0, 0, r * 0.9])
        cylinder(r1=0.15, r2=0.06, h=0.18, center=true);
    translate([0.28, 0.1, r * 0.9 + 0.1])
        rotate([20, -15, 25])
        cube([0.45, 0.22, 0.05], center=true);
}
`,
);

// Tier 5: Apple
writeFile(
  "assets/models/fruit_5.scad",
  `$fn = 30;
$asa = 45;
r = 1.65;

difference() {
    color([0.9, 0.08, 0.12], roughness=0.15, clearcoat=0.9, clearcoatRoughness=0.05) {
        scale([1.0, 1.0, 0.95])
            sphere(r=r);
    }
    translate([0, 0, r * 0.95])
        sphere(r=0.4);
    translate([0, 0, -r * 0.95])
        sphere(r=0.35);
}

color([0.35, 0.2, 0.1], roughness=0.8) {
    translate([0.05, 0, r * 0.9])
        rotate([0, 12, 0])
        cylinder(r=0.07, h=0.55, center=true);
}

color([0.15, 0.7, 0.2], roughness=0.4) {
    translate([0.35, 0, r * 0.95])
        rotate([10, -25, 30])
        cube([0.5, 0.26, 0.05], center=true);
}
`,
);

// Tier 6: Peach
writeFile(
  "assets/models/fruit_6.scad",
  `$fn = 30;
$asa = 45;
r = 2.05;

color([1.0, 0.42, 0.45], roughness=0.6, sheen=1.0, sheenColor=[1.0, 0.7, 0.5]) {
    translate([-0.18, 0, 0])
        scale([1.0, 0.96, 1.05])
        sphere(r=r * 0.94);
    translate([0.18, 0, 0])
        scale([1.0, 0.96, 1.05])
        sphere(r=r * 0.94);
}

color([0.2, 0.65, 0.25], roughness=0.5) {
    translate([0.25, 0, r + 0.1])
        rotate([15, -35, 40])
        cube([0.7, 0.35, 0.06], center=true);
    translate([0, 0, r + 0.05])
        cylinder(r=0.08, h=0.3, center=true);
}
`,
);

// Tier 7: Melon
writeFile(
  "assets/models/fruit_7.scad",
  `$fn = 32;
$asa = 45;
r = 2.5;

color([0.52, 0.88, 0.42], roughness=0.35, clearcoat=0.3) {
    sphere(r=r);
}

color([0.88, 0.98, 0.62], roughness=0.6) {
    for (i = [0:5]) {
        rotate([0, 0, i * 30])
            rotate([90, 0, 0])
            difference() {
                cylinder(r=r + 0.03, h=0.18, center=true);
                cylinder(r=r - 0.05, h=0.25, center=true);
            }
    }
}

color([0.28, 0.55, 0.2], roughness=0.7) {
    translate([0, 0, r + 0.1])
        cylinder(r=0.18, h=0.35, center=true);
}
`,
);

// Tier 8: Watermelon
writeFile(
  "assets/models/fruit_8.scad",
  `$fn = 32;
$asa = 45;
r = 3.0;

color([0.22, 0.72, 0.28], roughness=0.2, clearcoat=0.6) {
    sphere(r=r);
}

color([0.06, 0.28, 0.1], roughness=0.35) {
    for (a = [0:7]) {
        rotate([0, 0, a * 45])
            rotate([0, 18, 0])
            difference() {
                sphere(r=r + 0.02);
                sphere(r=r - 0.05);
                cube([r * 3, r * 1.5, r * 3], center=true);
            }
    }
}

color([0.2, 0.45, 0.15], roughness=0.6) {
    translate([0, 0, r + 0.15])
        cylinder(r1=0.25, r2=0.12, h=0.45, center=true);
}
`,
);

// Tier 9: Celestial King Watermelon
writeFile(
  "assets/models/fruit_9.scad",
  `$fn = 32;
$asa = 45;
r = 3.6;

color([1.0, 0.78, 0.15], emissive=[0.9, 0.55, 0.05], emissiveIntensity=1.5, metalness=0.4, roughness=0.2, clearcoat=1.0) {
    sphere(r=r);
}

color([1.0, 0.85, 0.25], metalness=0.9, roughness=0.2) {
    translate([0, 0, r + 0.35]) {
        cylinder(r=1.2, h=0.3, center=true);
        for (i = [0:5]) {
            rotate([0, 0, i * 60])
                translate([1.05, 0, 0.45])
                cylinder(r1=0.22, r2=0.03, h=0.7, center=true);
        }
    }
}

color([0.2, 0.9, 1.0], emissive=[0.3, 0.9, 1.0], emissiveIntensity=3.0, roughness=0.1) {
    for (i = [0:5]) {
        rotate([0, 0, i * 60 + 30])
            translate([1.1, 0, r + 0.45])
            sphere(r=0.15);
    }
    translate([0, 0, r + 1.2])
        sphere(r=0.28);
}
`,
);

// ==========================================
// 3. GODOT 4 SCRIPTS & DATA
// ==========================================

writeFile(
  "project.godot",
  `config_version=5

[application]

config/name="Fruit Fusion 3D"
config/description="3D Merge Game in Godot 4"
run/main_scene="res://scenes/main.tscn"
config/features=PackedStringArray("4.3", "Forward Plus")

[autoload]

AudioManager="*res://scripts/audio_manager.gd"

[display]

window/size/viewport_width=720
window/size/viewport_height=1080
window/size/mode=0
window/size/resizable=true
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"
window/handheld/orientation=1

[editor_plugins]

enabled=PackedStringArray("res://addons/scad_importer/plugin.cfg")

[rendering]

anti_aliasing/quality/msaa_3d=2
anti_aliasing/quality/screen_space_aa=1
lights_and_shadows/directional_shadow/soft_shadow_filter_quality=2
`,
);

writeFile(
  ".gitignore",
  `.godot/
*.tmp
*.log
`,
);

writeFile(
  "scripts/audio_manager.gd",
  `extends Node

var sample_rate: float = 22050.0

func _ready():
	process_mode = Node.PROCESS_MODE_ALWAYS

func play_pop_sound(pitch_mult: float = 1.0):
	_generate_and_play_sfx(350.0 * pitch_mult, 700.0 * pitch_mult, 0.12, 0.4, "sine")

func play_merge_sound(tier: int):
	var base_freq = 240.0 + (tier * 75.0)
	_generate_and_play_sfx(base_freq, base_freq * 1.5, 0.22, 0.55, "triangle")

func play_drop_sound():
	_generate_and_play_sfx(180.0, 110.0, 0.09, 0.35, "sine")

func play_game_over_sound():
	_generate_and_play_sfx(300.0, 120.0, 0.6, 0.6, "saw")

func _generate_and_play_sfx(start_freq: float, end_freq: float, duration: float, volume: float, wave_type: String):
	var player = AudioStreamPlayer.new()
	add_child(player)

	var total_frames = int(sample_rate * duration)
	var byte_data = PackedByteArray()

	for i in range(total_frames):
		var t = float(i) / float(total_frames)
		var current_freq = lerp(start_freq, end_freq, t)
		var phase = float(i) * current_freq * TAU / sample_rate

		var sample: float = 0.0
		if wave_type == "sine":
			sample = sin(phase)
		elif wave_type == "triangle":
			sample = asin(sin(phase)) * (2.0 / PI)
		elif wave_type == "saw":
			sample = (fposmod(phase, TAU) / PI) - 1.0

		var envelope = sin(t * PI * 0.5) * exp(-t * 4.5) * volume
		sample *= envelope

		var int_val = int(clamp(sample, -1.0, 1.0) * 32767.0)
		byte_data.append(int_val & 0xFF)
		byte_data.append((int_val >> 8) & 0xFF)

	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = int(sample_rate)
	stream.stereo = false
	stream.data = byte_data

	player.stream = stream
	player.play()
	player.finished.connect(player.queue_free)
`,
);

writeFile(
  "scripts/fruit_data.gd",
  `class_name FruitData
extends RefCounted

const FRUIT_NAMES = [
	"Cherry",
	"Strawberry",
	"Grape",
	"Tangerine",
	"Apple",
	"Peach",
	"Melon",
	"Watermelon",
	"King Sun"
]

const FRUIT_RADII = [
	0.55,
	0.75,
	0.98,
	1.30,
	1.65,
	2.05,
	2.50,
	3.00,
	3.60
]

const FRUIT_SCORES = [
	2,
	4,
	8,
	16,
	32,
	64,
	128,
	256,
	512
]

const FRUIT_COLORS = [
	Color(0.85, 0.05, 0.15),
	Color(0.95, 0.12, 0.28),
	Color(0.55, 0.15, 0.75),
	Color(1.00, 0.50, 0.05),
	Color(0.90, 0.10, 0.12),
	Color(1.00, 0.55, 0.50),
	Color(0.55, 0.88, 0.45),
	Color(0.18, 0.65, 0.25),
	Color(1.00, 0.82, 0.15)
]

static func get_model_path(tier: int) -> String:
	return "res://assets/models/fruit_%d.scad" % clampi(tier, 1, 9)
`,
);

writeFile(
  "scripts/fruit.gd",
  `class_name Fruit
extends RigidBody3D

signal fruit_merged(pos: Vector3, next_tier: int, score: int)
signal settled_in_danger_zone(fruit_node: Fruit)

@export var tier: int = 1

var radius: float = 0.55
var is_merging: bool = false
var has_dropped: bool = false
var drop_time: float = 0.0
var model_instance: Node3D = null

func setup(p_tier: int):
	tier = clampi(p_tier, 1, 9)
	radius = FruitData.FRUIT_RADII[tier - 1]
	mass = pow(radius, 2.5) * 1.5

	for child in get_children():
		if child is CollisionShape3D or child is Node3D:
			child.queue_free()

	var col = CollisionShape3D.new()
	var sphere = SphereShape3D.new()
	sphere.radius = radius
	col.shape = sphere
	add_child(col)

	var model_path = FruitData.get_model_path(tier)
	if ResourceLoader.exists(model_path):
		var model_scene = load(model_path)
		if model_scene:
			model_instance = model_scene.instantiate()
			add_child(model_instance)

	if not model_instance:
		var fallback_mesh = MeshInstance3D.new()
		var s_mesh = SphereMesh.new()
		s_mesh.radius = radius
		s_mesh.height = radius * 2.0
		fallback_mesh.mesh = s_mesh
		var mat = StandardMaterial3D.new()
		mat.albedo_color = FruitData.FRUIT_COLORS[tier - 1]
		mat.roughness = 0.3
		fallback_mesh.material_override = mat
		add_child(fallback_mesh)

func _ready():
	axis_lock_linear_z = true
	axis_lock_angular_x = true
	axis_lock_angular_y = true

	contact_monitor = true
	max_contacts_reported = 4
	body_entered.connect(_on_body_entered)

	scale = Vector3.ONE * 0.2
	var tween = create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "scale", Vector3.ONE, 0.25)

func _process(delta):
	if has_dropped:
		drop_time += delta
		if drop_time > 2.5 and global_position.y >= 13.5 and linear_velocity.length() < 0.6:
			settled_in_danger_zone.emit(self)

func _on_body_entered(body: Node):
	if is_merging:
		return

	if body is Fruit:
		var other: Fruit = body
		if other.is_merging:
			return

		if other.tier == self.tier and self.tier < 9:
			if self.get_instance_id() < other.get_instance_id():
				self.is_merging = true
				other.is_merging = true
				var merge_pos = (global_position + other.global_position) * 0.5
				fruit_merged.emit(merge_pos, self.tier + 1, FruitData.FRUIT_SCORES[self.tier - 1])
				other.queue_free()
				self.queue_free()
`,
);

writeFile(
  "scripts/game_manager.gd",
  `class_name GameManager
extends Node3D

signal score_updated(score: int, high_score: int)
signal next_fruit_changed(tier: int)
signal game_over_triggered

@onready var dropper: Node3D = $Dropper
@onready var fruits_container: Node3D = $FruitsContainer
@onready var aim_line: MeshInstance3D = $AimLine
@onready var container_visual: Node3D = $ContainerVisual

const BOX_HALF_WIDTH: float = 4.8
const DROP_HEIGHT: float = 14.8

var current_score: int = 0
var high_score: int = 0
var next_tier: int = 1
var active_preview_tier: int = 1
var preview_fruit_node: Node3D = null

var can_drop: bool = true
var drop_cooldown: float = 0.55
var is_game_over: bool = false
var danger_timer: float = 0.0
const DANGER_THRESHOLD: float = 2.8

var high_score_file = "user://fusion_highscore.save"

func _ready():
	load_high_score()
	score_updated.emit(current_score, high_score)

	_setup_container_visuals()
	_setup_dropper_visuals()

	randomize()
	active_preview_tier = randi_range(1, 3)
	next_tier = randi_range(1, 3)
	next_fruit_changed.emit(next_tier)

	_spawn_preview_fruit()
	_update_aim_line()

func _setup_container_visuals():
	if not is_instance_valid(container_visual):
		return

	var loaded_scad = false
	var container_model_path = "res://assets/models/container.scad"
	if ResourceLoader.exists(container_model_path):
		var container_scene = load(container_model_path)
		if container_scene:
			var c_inst = container_scene.instantiate()
			container_visual.add_child(c_inst)
			_enforce_glass_transparency(c_inst)
			loaded_scad = true

	if not loaded_scad:
		_build_procedural_glass_box()

func _enforce_glass_transparency(root_node: Node):
	for child in root_node.get_children():
		if child is MeshInstance3D:
			var mesh = child.mesh
			if mesh:
				for s in range(mesh.get_surface_count()):
					var mat = child.get_active_material(s)
					if mat is BaseMaterial3D:
						# If it is a glass material (light tint or transmission/alpha flag)
						if mat.albedo_color.a < 0.95 or mat.albedo_color.b > 0.85:
							var glass = mat.duplicate()
							glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
							glass.cull_mode = BaseMaterial3D.CULL_BACK
							glass.albedo_color = Color(0.85, 0.95, 1.0, 0.12)
							glass.roughness = 0.05
							glass.metallic = 0.1
							glass.clearcoat_enabled = true
							glass.clearcoat = 1.0
							child.set_surface_override_material(s, glass)
		_enforce_glass_transparency(child)

func _build_procedural_glass_box():
	# Procedural transparent glass box with visible frames
	var glass_mat = StandardMaterial3D.new()
	glass_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass_mat.cull_mode = BaseMaterial3D.CULL_BACK
	glass_mat.albedo_color = Color(0.85, 0.95, 1.0, 0.12)
	glass_mat.roughness = 0.05
	glass_mat.metallic = 0.05
	glass_mat.clearcoat_enabled = true
	glass_mat.clearcoat = 1.0

	var frame_mat = StandardMaterial3D.new()
	frame_mat.albedo_color = Color(0.8, 0.85, 0.9, 1.0)
	frame_mat.metallic = 0.85
	frame_mat.roughness = 0.25

	# Back Glass
	var back_mesh = MeshInstance3D.new()
	var bm = BoxMesh.new()
	bm.size = Vector3(12.0, 16.0, 0.1)
	back_mesh.mesh = bm
	back_mesh.material_override = glass_mat
	back_mesh.position = Vector3(0, 8.0, -2.0)
	container_visual.add_child(back_mesh)

	# Left Glass
	var left_mesh = MeshInstance3D.new()
	var lm = BoxMesh.new()
	lm.size = Vector3(0.1, 16.0, 4.0)
	left_mesh.mesh = lm
	left_mesh.material_override = glass_mat
	left_mesh.position = Vector3(-6.0, 8.0, 0)
	container_visual.add_child(left_mesh)

	# Right Glass
	var right_mesh = MeshInstance3D.new()
	var rm = BoxMesh.new()
	rm.size = Vector3(0.1, 16.0, 4.0)
	right_mesh.mesh = rm
	right_mesh.material_override = glass_mat
	right_mesh.position = Vector3(6.0, 8.0, 0)
	container_visual.add_child(right_mesh)

	# Front Ultra-clear Glass
	var front_mat = glass_mat.duplicate()
	front_mat.albedo_color = Color(0.9, 0.97, 1.0, 0.07)
	var front_mesh = MeshInstance3D.new()
	var fm = BoxMesh.new()
	fm.size = Vector3(12.0, 16.0, 0.05)
	front_mesh.mesh = fm
	front_mesh.material_override = front_mat
	front_mesh.position = Vector3(0, 8.0, 2.0)
	container_visual.add_child(front_mesh)

	# Wooden Base
	var base_mesh = MeshInstance3D.new()
	var basem = BoxMesh.new()
	basem.size = Vector3(13.6, 0.8, 5.6)
	base_mesh.mesh = basem
	var wood_mat = StandardMaterial3D.new()
	wood_mat.albedo_color = Color(0.55, 0.32, 0.16)
	wood_mat.roughness = 0.7
	base_mesh.material_override = wood_mat
	base_mesh.position = Vector3(0, -0.4, 0)
	container_visual.add_child(base_mesh)

	# Danger Line Marker at Y = 13.5
	var danger_mat = StandardMaterial3D.new()
	danger_mat.albedo_color = Color(1.0, 0.2, 0.2, 1.0)
	danger_mat.emission_enabled = true
	danger_mat.emission = Color(1.0, 0.2, 0.2)
	danger_mat.emission_energy_multiplier = 2.5
	var danger_line = MeshInstance3D.new()
	var dlm = BoxMesh.new()
	dlm.size = Vector3(12.4, 0.12, 4.4)
	danger_line.mesh = dlm
	danger_line.material_override = danger_mat
	danger_line.position = Vector3(0, 13.5, 0)
	container_visual.add_child(danger_line)

func _setup_dropper_visuals():
	var dropper_model_path = "res://assets/models/dropper.scad"
	if ResourceLoader.exists(dropper_model_path) and is_instance_valid(dropper):
		var dropper_scene = load(dropper_model_path)
		if dropper_scene:
			if dropper.has_node("CloudMesh"):
				dropper.get_node("CloudMesh").visible = false
			if dropper.has_node("PointerMesh"):
				dropper.get_node("PointerMesh").visible = false
			var d_inst = dropper_scene.instantiate()
			dropper.add_child(d_inst)

func load_high_score():
	if FileAccess.file_exists(high_score_file):
		var file = FileAccess.open(high_score_file, FileAccess.READ)
		if file:
			high_score = file.get_32()
			file.close()

func save_high_score():
	var file = FileAccess.open(high_score_file, FileAccess.WRITE)
	if file:
		file.store_32(high_score)
		file.close()

func _unhandled_input(event: InputEvent):
	if is_game_over or not is_instance_valid(dropper):
		return

	if event is InputEventMouseMotion:
		var vp_size = get_viewport().get_visible_rect().size
		if vp_size.x > 0.0:
			var norm_x = (event.position.x / vp_size.x) * 2.0 - 1.0
			var target_x = clamp(norm_x * (BOX_HALF_WIDTH + 0.5), -BOX_HALF_WIDTH, BOX_HALF_WIDTH)
			dropper.position.x = target_x
			_update_aim_line()

	if event.is_action_pressed("ui_accept") or (event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.is_pressed()):
		try_drop_fruit()

func _physics_process(delta: float):
	if not is_inside_tree() or not is_instance_valid(fruits_container) or not is_instance_valid(dropper):
		return

	if is_game_over:
		return

	var move_dir = Input.get_axis("ui_left", "ui_right")
	if move_dir != 0.0:
		dropper.position.x = clamp(dropper.position.x + move_dir * 14.0 * delta, -BOX_HALF_WIDTH, BOX_HALF_WIDTH)
		_update_aim_line()

	var fruits_in_danger = 0
	for fruit in fruits_container.get_children():
		if is_instance_valid(fruit) and fruit is Fruit and fruit.has_dropped:
			if fruit.global_position.y >= 13.5 and fruit.drop_time > 2.0 and fruit.linear_velocity.length() < 0.5:
				fruits_in_danger += 1

	if fruits_in_danger > 0:
		danger_timer += delta
		if danger_timer >= DANGER_THRESHOLD:
			trigger_game_over()
	else:
		danger_timer = max(0.0, danger_timer - delta * 1.5)

func _update_aim_line():
	if is_instance_valid(aim_line) and is_instance_valid(dropper):
		aim_line.position.x = dropper.position.x
		aim_line.position.y = DROP_HEIGHT * 0.5
		aim_line.scale.y = DROP_HEIGHT

func _spawn_preview_fruit():
	if not is_instance_valid(dropper):
		return

	if is_instance_valid(preview_fruit_node):
		preview_fruit_node.queue_free()
		preview_fruit_node = null

	var model_path = FruitData.get_model_path(active_preview_tier)
	if ResourceLoader.exists(model_path):
		var scene = load(model_path)
		if scene:
			preview_fruit_node = scene.instantiate()
			dropper.add_child(preview_fruit_node)
			preview_fruit_node.position = Vector3(0, -0.9, 0)

	if not preview_fruit_node:
		var mesh_inst = MeshInstance3D.new()
		var sm = SphereMesh.new()
		sm.radius = FruitData.FRUIT_RADII[active_preview_tier - 1]
		sm.height = sm.radius * 2.0
		mesh_inst.mesh = sm
		var mat = StandardMaterial3D.new()
		mat.albedo_color = FruitData.FRUIT_COLORS[active_preview_tier - 1]
		mesh_inst.material_override = mat
		preview_fruit_node = mesh_inst
		dropper.add_child(preview_fruit_node)
		preview_fruit_node.position = Vector3(0, -0.9, 0)

func try_drop_fruit():
	if not can_drop or is_game_over or not is_instance_valid(fruits_container) or not is_instance_valid(dropper):
		return

	can_drop = false
	AudioManager.play_drop_sound()

	var fruit = Fruit.new()
	fruits_container.add_child(fruit)
	fruit.setup(active_preview_tier)
	fruit.position = dropper.position + Vector3(0, -0.9, 0)
	fruit.has_dropped = true
	fruit.fruit_merged.connect(_on_fruit_merged)

	if is_instance_valid(preview_fruit_node):
		preview_fruit_node.queue_free()
		preview_fruit_node = null

	active_preview_tier = next_tier
	next_tier = randi_range(1, 3)
	next_fruit_changed.emit(next_tier)

	get_tree().create_timer(drop_cooldown).timeout.connect(func():
		if not is_game_over:
			can_drop = true
			_spawn_preview_fruit()
	)

func _on_fruit_merged(merge_pos: Vector3, new_tier: int, score_awarded: int):
	current_score += score_awarded
	if current_score > high_score:
		high_score = current_score
		save_high_score()
	score_updated.emit(current_score, high_score)

	AudioManager.play_merge_sound(new_tier)
	_spawn_merge_vfx(merge_pos, FruitData.FRUIT_COLORS[new_tier - 2])

	if not is_instance_valid(fruits_container):
		return

	var evolved_fruit = Fruit.new()
	fruits_container.add_child(evolved_fruit)
	evolved_fruit.setup(new_tier)
	evolved_fruit.position = merge_pos
	evolved_fruit.has_dropped = true
	evolved_fruit.drop_time = 1.0
	evolved_fruit.fruit_merged.connect(_on_fruit_merged)

func _spawn_merge_vfx(pos: Vector3, color: Color):
	var particles = CPUParticles3D.new()
	add_child(particles)
	particles.position = pos
	particles.emitting = true
	particles.one_shot = true
	particles.explosiveness = 0.95
	particles.lifetime = 0.45
	particles.amount = 24
	particles.spread = 180.0
	particles.initial_velocity_min = 4.0
	particles.initial_velocity_max = 8.0
	particles.scale_amount_min = 0.15
	particles.scale_amount_max = 0.35
	particles.color = color

	var mesh = BoxMesh.new()
	mesh.size = Vector3(0.2, 0.2, 0.2)
	particles.mesh = mesh

	get_tree().create_timer(0.55).timeout.connect(particles.queue_free)

func trigger_game_over():
	if is_game_over:
		return
	is_game_over = true
	AudioManager.play_game_over_sound()
	game_over_triggered.emit()

func restart_game():
	if is_instance_valid(fruits_container):
		for child in fruits_container.get_children():
			child.queue_free()
	current_score = 0
	danger_timer = 0.0
	is_game_over = false
	can_drop = true
	score_updated.emit(current_score, high_score)
	active_preview_tier = randi_range(1, 3)
	next_tier = randi_range(1, 3)
	next_fruit_changed.emit(next_tier)
	_spawn_preview_fruit()
`,
);

writeFile(
  "scripts/ui_manager.gd",
  `extends Control

@onready var game_manager: GameManager = $"../"
@onready var score_label = $ScoreContainer/ScoreValue
@onready var high_score_label = $ScoreContainer/HighScoreValue
@onready var next_fruit_preview = $NextContainer/PreviewRect
@onready var next_fruit_label = $NextContainer/NextFruitName
@onready var game_over_panel = $GameOverPanel
@onready var final_score_label = $GameOverPanel/FinalScore
@onready var restart_button = $GameOverPanel/RestartButton
@onready var danger_indicator = $DangerIndicator

var danger_blink_time: float = 0.0

func _ready():
	game_over_panel.visible = false
	danger_indicator.visible = false
	restart_button.pressed.connect(_on_restart_pressed)
	game_manager.score_updated.connect(_on_score_updated)
	game_manager.next_fruit_changed.connect(_on_next_fruit_changed)
	game_manager.game_over_triggered.connect(_on_game_over)

func _process(delta):
	if is_instance_valid(game_manager) and game_manager.danger_timer > 0.5 and not game_manager.is_game_over:
		danger_indicator.visible = true
		danger_blink_time += delta * 6.0
		danger_indicator.modulate.a = (sin(danger_blink_time) * 0.5 + 0.5) * 0.85
	else:
		danger_indicator.visible = false
		danger_blink_time = 0.0

func _on_score_updated(score: int, high_score: int):
	score_label.text = str(score)
	high_score_label.text = "BEST: " + str(high_score)

func _on_next_fruit_changed(tier: int):
	var fruit_name = FruitData.FRUIT_NAMES[tier - 1]
	next_fruit_label.text = fruit_name
	next_fruit_preview.color = FruitData.FRUIT_COLORS[tier - 1]

func _on_game_over():
	game_over_panel.visible = true
	final_score_label.text = "FINAL SCORE: %d" % game_manager.current_score

func _on_restart_pressed():
	game_over_panel.visible = false
	game_manager.restart_game()
`,
);

// ==========================================
// 4. MAIN SCENE FILE (.tscn)
// ==========================================

writeFile(
  "scenes/main.tscn",
  `[gd_scene load_steps=15 format=3 uid="uid://c2suika0main"]

[ext_resource type="Script" path="res://scripts/game_manager.gd" id="1_gm"]
[ext_resource type="Script" path="res://scripts/ui_manager.gd" id="2_ui"]

[sub_resource type="ProceduralSkyMaterial" id="ProceduralSkyMaterial_sky"]
sky_top_color = Color(0.2, 0.45, 0.75, 1)
sky_horizon_color = Color(0.65, 0.78, 0.88, 1)
ground_bottom_color = Color(0.12, 0.16, 0.22, 1)
ground_horizon_color = Color(0.65, 0.78, 0.88, 1)

[sub_resource type="Sky" id="Sky_env"]
sky_material = SubResource("ProceduralSkyMaterial_sky")

[sub_resource type="Environment" id="Environment_main"]
background_mode = 2
sky = SubResource("Sky_env")
ambient_light_source = 2
ambient_light_color = Color(0.4, 0.4, 0.45, 1)
tonemap_mode = 2
glow_enabled = true
glow_intensity = 0.4
glow_bloom = 0.15

[sub_resource type="BoxShape3D" id="BoxShape3D_bottom"]
size = Vector3(14, 0.5, 6)

[sub_resource type="BoxShape3D" id="BoxShape3D_wall"]
size = Vector3(0.5, 18, 6)

[sub_resource type="BoxShape3D" id="BoxShape3D_back"]
size = Vector3(14, 18, 0.5)

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_aim"]
transparency = 1
albedo_color = Color(1, 0.9, 0.3, 0.35)
emission_enabled = true
emission = Color(1, 0.85, 0.2, 1)
emission_energy_multiplier = 0.8

[sub_resource type="CylinderMesh" id="CylinderMesh_aim"]
material = SubResource("StandardMaterial3D_aim")
top_radius = 0.04
bottom_radius = 0.04
height = 1.0

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_cloud"]
albedo_color = Color(0.95, 0.96, 1, 1)
roughness = 0.4

[sub_resource type="SphereMesh" id="SphereMesh_cloud"]
material = SubResource("StandardMaterial3D_cloud")
radius = 0.8
height = 1.6

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_pointer"]
albedo_color = Color(1, 0.8, 0.1, 1)
emission_enabled = true
emission = Color(1, 0.7, 0, 1)
emission_energy_multiplier = 2.0

[sub_resource type="CylinderMesh" id="CylinderMesh_pointer"]
material = SubResource("StandardMaterial3D_pointer")
top_radius = 0.02
bottom_radius = 0.22
height = 0.45

[node name="Main" type="Node3D"]
script = ExtResource("1_gm")

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_main")

[node name="DirectionalLight3D" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.866, -0.353, 0.353, 0, 0.707, 0.707, -0.5, -0.612, 0.612, 5, 20, 15)
light_color = Color(1, 0.98, 0.94, 1)
light_energy = 1.2
shadow_enabled = true

[node name="FillLight" type="DirectionalLight3D" parent="."]
transform = Transform3D(-0.866, 0.25, -0.433, 0, 0.866, 0.5, 0.5, 0.433, -0.75, -5, 10, -10)
light_color = Color(0.5, 0.7, 0.9, 1)
light_energy = 0.4

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.996, 0.087, 0, -0.087, 0.996, 0, 8.5, 21.5)
fov = 48.0

[node name="ContainerPhysics" type="StaticBody3D" parent="."]

[node name="CollisionBottom" type="CollisionShape3D" parent="ContainerPhysics"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.25, 0)
shape = SubResource("BoxShape3D_bottom")

[node name="CollisionLeft" type="CollisionShape3D" parent="ContainerPhysics"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -6.2, 8, 0)
shape = SubResource("BoxShape3D_wall")

[node name="CollisionRight" type="CollisionShape3D" parent="ContainerPhysics"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 6.2, 8, 0)
shape = SubResource("BoxShape3D_wall")

[node name="CollisionBack" type="CollisionShape3D" parent="ContainerPhysics"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 8, -2.2)
shape = SubResource("BoxShape3D_back")

[node name="CollisionFront" type="CollisionShape3D" parent="ContainerPhysics"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 8, 2.2)
shape = SubResource("BoxShape3D_back")

[node name="ContainerVisual" type="Node3D" parent="."]

[node name="FruitsContainer" type="Node3D" parent="."]

[node name="AimLine" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 7.5, 0)
mesh = SubResource("CylinderMesh_aim")

[node name="Dropper" type="Node3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 15.2, 0)

[node name="CloudMesh" type="MeshInstance3D" parent="Dropper"]
mesh = SubResource("SphereMesh_cloud")

[node name="PointerMesh" type="MeshInstance3D" parent="Dropper"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.9, 0)
mesh = SubResource("CylinderMesh_pointer")

[node name="UI" type="Control" parent="."]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2
script = ExtResource("2_ui")

[node name="ScoreContainer" type="VBoxContainer" parent="UI"]
layout_mode = 0
offset_left = 30.0
offset_top = 25.0
offset_right = 260.0
offset_bottom = 110.0

[node name="ScoreLabel" type="Label" parent="UI/ScoreContainer"]
layout_mode = 2
theme_override_font_sizes/font_size = 18
theme_override_colors/font_color = Color(0.85, 0.9, 1, 0.8)
text = "SCORE"

[node name="ScoreValue" type="Label" parent="UI/ScoreContainer"]
layout_mode = 2
theme_override_font_sizes/font_size = 40
theme_override_colors/font_color = Color(1, 1, 1, 1)
text = "0"

[node name="HighScoreValue" type="Label" parent="UI/ScoreContainer"]
layout_mode = 2
theme_override_font_sizes/font_size = 16
theme_override_colors/font_color = Color(1, 0.85, 0.3, 0.9)
text = "BEST: 0"

[node name="NextContainer" type="VBoxContainer" parent="UI"]
layout_mode = 1
anchors_preset = 1
anchor_left = 1.0
anchor_right = 1.0
offset_left = -150.0
offset_top = 25.0
offset_right = -30.0
offset_bottom = 135.0
grow_horizontal = 0
alignment = 1

[node name="NextTitle" type="Label" parent="UI/NextContainer"]
layout_mode = 2
theme_override_font_sizes/font_size = 16
theme_override_colors/font_color = Color(0.85, 0.9, 1, 0.8)
text = "NEXT"
horizontal_alignment = 1

[node name="PreviewRect" type="ColorRect" parent="UI/NextContainer"]
custom_minimum_size = Vector2(48, 48)
layout_mode = 2
color = Color(0.95, 0.12, 0.28, 1)

[node name="NextFruitName" type="Label" parent="UI/NextContainer"]
layout_mode = 2
theme_override_font_sizes/font_size = 14
theme_override_colors/font_color = Color(1, 1, 1, 0.9)
text = "Strawberry"
horizontal_alignment = 1

[node name="EvolutionGuide" type="HBoxContainer" parent="UI"]
layout_mode = 1
anchors_preset = 12
anchor_top = 1.0
anchor_right = 1.0
anchor_bottom = 1.0
offset_top = -55.0
offset_bottom = -15.0
grow_horizontal = 2
grow_vertical = 0
alignment = 1

[node name="GuideLabel" type="Label" parent="UI/EvolutionGuide"]
layout_mode = 2
theme_override_font_sizes/font_size = 15
theme_override_colors/font_color = Color(1, 1, 1, 0.75)
text = "🍒 Cherry → 🍓 Strawberry → 🍇 Grape → 🍊 Orange → 🍎 Apple → 🍑 Peach → 🍈 Melon → 🍉 Watermelon → 👑 Sun"

[node name="DangerIndicator" type="ColorRect" parent="UI"]
visible = false
layout_mode = 1
anchors_preset = 10
anchor_right = 1.0
offset_top = 145.0
offset_bottom = 155.0
grow_horizontal = 2
color = Color(1, 0.15, 0.15, 0.6)

[node name="GameOverPanel" type="Panel" parent="UI"]
visible = false
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -170.0
offset_top = -140.0
offset_right = 170.0
offset_bottom = 140.0
grow_horizontal = 2
grow_vertical = 2

[node name="Title" type="Label" parent="UI/GameOverPanel"]
layout_mode = 1
anchors_preset = 10
anchor_right = 1.0
offset_top = 25.0
offset_bottom = 65.0
grow_horizontal = 2
theme_override_font_sizes/font_size = 28
theme_override_colors/font_color = Color(1, 0.3, 0.3, 1)
text = "GAME OVER"
horizontal_alignment = 1

[node name="FinalScore" type="Label" parent="UI/GameOverPanel"]
layout_mode = 1
anchors_preset = 10
anchor_right = 1.0
offset_top = 80.0
offset_bottom = 120.0
grow_horizontal = 2
theme_override_font_sizes/font_size = 22
text = "FINAL SCORE: 0"
horizontal_alignment = 1

[node name="RestartButton" type="Button" parent="UI/GameOverPanel"]
layout_mode = 1
anchors_preset = 7
anchor_left = 0.5
anchor_top = 1.0
anchor_right = 0.5
anchor_bottom = 1.0
offset_left = -90.0
offset_top = -75.0
offset_right = 90.0
offset_bottom = -25.0
grow_horizontal = 2
grow_vertical = 0
theme_override_font_sizes/font_size = 20
text = "PLAY AGAIN"
`,
);

// ==========================================
// 5. DOCUMENTATION (README.md)
// ==========================================

writeFile(
  "README.md",
  `# Fruit Fusion 3D (Suika Game Mechanic in Godot 4)

A popular merge puzzle game inspired by the Watermelon / Suika Game, implemented in **Godot 4** with procedural **OpenSCAD 3D models** and PBR materials.

## Game Overview
Drop different fruits into the transparent glass container. When two identical fruits collide, they merge with a satisfying pop and evolve into a larger, higher-tier fruit!

### Evolution Chain:
1. 🍒 **Cherry**
2. 🍓 **Strawberry**
3. 🍇 **Grape**
4. 🍊 **Tangerine / Orange**
5. 🍎 **Apple**
6. 🍑 **Peach**
7. 🍈 **Melon**
8. 🍉 **Watermelon**
9. 👑 **King Sun** (Ultimate crowned glowing celestial watermelon)

---

## Controls
- **Move Dropper / Aim**:
  - Mouse Move / Touch Drag
  - Left / Right Arrow keys
  - A / D keys
- **Drop Fruit**:
  - Left Click
  - Spacebar
  - Enter
  - Down Arrow
`,
);

console.log(`
=====================================================
Setup complete! Project created in ./${PROJECT_DIR}
To run the game:
  1. Open Godot 4
  2. Import the project located at ./${PROJECT_DIR}/project.godot
  3. Run the project (F5)
=====================================================
`);
