#!/usr/bin/env node

/**
 * Procedural Generator for "kids_digit_writing"
 * Godot 4 Kids Digit Writing Learning App with 3D Teacher Mouse Robot
 * Calibrated lighting, soft PBR toy materials, and glare-free colors
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(process.cwd(), "kids_digit_writing");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(relativePath, content) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content.trim() + "\n", "utf8");
  console.log(`  [CREATED] ${relativePath}`);
}

console.log("Generating Godot 4 Project: kids_digit_writing ...\n");

// -------------------------------------------------------------------------
// 1. ADDON: godot/addons/scad_importer/*
// -------------------------------------------------------------------------

writeFile(
  "addons/scad_importer/plugin.cfg",
  `
[plugin]

name="OpenSCAD GLTF Importer"
description="Imports .scad files directly as 3D scenes using scad-gltf"
author="Ilia Grigorev"
version="0.1"
script="scad_plugin.gd"
license="MIT"
`,
);

writeFile(
  "addons/scad_importer/scad_importer.gd",
  `# Copyright (c) 2026 Ilia Grigorev. Distributed under the MIT License.
# See LICENSE in the addon directory for details.

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

writeFile(
  "addons/scad_importer/scad_plugin.gd",
  `# Copyright (c) 2026 Ilia Grigorev. Distributed under the MIT License.
# See LICENSE in the addon directory for details.

@tool
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

// -------------------------------------------------------------------------
// 2. 3D MODELS (.scad)
// -------------------------------------------------------------------------

writeFile(
  "assets/models/mouse_robot.scad",
  `/* Model Name: mouse_robot */
// Note on Units: 1 unit ≈ 10 mm (1 cm). Total robot height is ~28 units (28 cm).
$fn = 36;
$asa = 45.0;

// -------------------------------------------------------------
// PBR Materials (Calibrated Anti-Glare Toy Enamel Shading)
// -------------------------------------------------------------
module mat_silver() {
    color([0.65, 0.72, 0.80], metalness=0.08, roughness=0.52, $asa=45) children();
}

module mat_cyan() {
    color([0.06, 0.66, 0.82], metalness=0.08, roughness=0.45, $asa=45) children();
}

module mat_blue_rim() {
    color([0.10, 0.32, 0.75], metalness=0.15, roughness=0.45, $asa=45) children();
}

module mat_magenta() {
    color([0.86, 0.16, 0.52], metalness=0.05, roughness=0.45, $asa=45) children();
}

module mat_purple() {
    color([0.50, 0.14, 0.62], metalness=0.08, roughness=0.50, $asa=45) children();
}

module mat_tan() {
    color([0.80, 0.64, 0.44], metalness=0.05, roughness=0.60, $asa=45) children();
}

module mat_black() {
    color([0.12, 0.13, 0.16], metalness=0.10, roughness=0.65, $asa=45) children();
}

module mat_white() {
    color([0.82, 0.84, 0.87], metalness=0.0, roughness=0.45, $asa=45) children();
}

module mat_dark_blue() {
    color([0.08, 0.18, 0.45], metalness=0.15, roughness=0.45, $asa=45) children();
}

// -------------------------------------------------------------
// Large Round Ears (Facing Forward along +Y)
// -------------------------------------------------------------
module robot_ear() {
    rotate([90, 0, 0]) {
        mat_cyan() {
            difference() {
                cylinder(r=4.8, h=0.9, center=true);
                cylinder(r=3.8, h=1.2, center=true);
            }
        }
        mat_magenta() {
            cylinder(r=3.9, h=0.7, center=true);
        }
        mat_silver() {
            translate([0, -4.6, 0])
                cylinder(r=0.6, h=1.6, center=true);
        }
    }
}

// -------------------------------------------------------------
// Robot Body Core & Face
// -------------------------------------------------------------
module robot_body() {
    mat_silver() {
        intersection() {
            scale([1.0, 0.92, 1.08]) sphere(r=8.0);
            translate([-10, -10, 1.0]) cube([20, 20, 10]);
        }
    }

    mat_silver() {
        translate([0, 0, 8.5]) cylinder(r=0.45, h=4.2);
        translate([0, 0, 13.0]) sphere(r=1.05);
    }

    mat_cyan() {
        intersection() {
            scale([1.01, 0.93, 1.09]) sphere(r=8.0);
            translate([-10, -10, -1.6]) cube([20, 20, 2.8]);
        }
    }

    mat_black() {
        intersection() {
            scale([1.03, 0.95, 1.11]) sphere(r=8.05);
            translate([-10, -10, -3.4]) cube([20, 20, 2.0]);
        }
        translate([0, 7.7, -2.4]) rotate([78, 0, 0])
            cylinder(r=0.9, h=0.7, center=true);
    }

    mat_purple() {
        intersection() {
            scale([1.0, 0.92, 1.08]) sphere(r=7.95);
            translate([-10, -10, -10]) cube([20, 20, 7.0]);
        }
    }

    for (s = [-1, 1]) {
        translate([s * 2.8, 6.4, 5.2]) rotate([-6, s * 8, 0]) {
            mat_white() sphere(r=1.25);
            mat_dark_blue() translate([0, 0.68, 0]) sphere(r=0.68);
            mat_white() translate([s * 0.3, 1.15, 0.3]) sphere(r=0.25);

            mat_dark_blue() {
                for (a = [-50, 0, 50]) {
                    rotate([0, a, 0]) translate([0, 0.7, 1.25])
                        cylinder(r=0.14, h=1.4);
                }
            }
        }
    }

    mat_dark_blue() {
        translate([0, 7.35, 4.2]) sphere(r=0.55);
    }

    mat_dark_blue() {
        for (i = [-5 : 5]) {
            let (
                u = i / 5.0,
                x = u * 1.15,
                z = 3.0 + (u * u) * 0.35,
                y = 7.55 - (u * u) * 0.15
            ) {
                translate([x, y, z]) sphere(r=0.18);
            }
        }
    }

    mat_white() {
        translate([-0.30, 7.58, 2.55]) cube([0.26, 0.28, 0.55], center=true);
        translate([0.30, 7.58, 2.55]) cube([0.26, 0.28, 0.55], center=true);
    }

    translate([6.8, 0.2, 7.5]) rotate([0, 18, 0]) robot_ear();
    translate([-6.8, 0.2, 7.5]) rotate([0, -18, 0]) robot_ear();
}

// -------------------------------------------------------------
// Arm Segments & 5 Spread Fan Wire Fingers
// -------------------------------------------------------------
module arm_upper() {
    mat_cyan() sphere(r=1.3);
    mat_cyan() {
        translate([0, 0, -1.4]) cylinder(r=1.1, h=2.4, center=true);
    }
    mat_tan() {
        translate([0, 0, -2.8]) sphere(r=0.9);
    }
}

module arm_forearm() {
    mat_tan() {
        translate([0, 0, -1.3]) cylinder(r=0.85, h=2.2, center=true);
        translate([0, 0, -2.6]) sphere(r=0.85);
    }
    mat_dark_blue() {
        translate([0, 0, -2.8]) {
            cylinder(r=0.85, h=0.45, center=true);
            for (f = [-60, -30, 0, 30, 60]) {
                rotate([0, f, 0]) {
                    translate([0, 0, -1.7]) cylinder(r=0.18, h=3.4, center=true);
                    translate([0, 0, -3.4]) sphere(r=0.32);
                }
            }
        }
    }
}

// -------------------------------------------------------------
// Leg Segments with Seamless Embedded Toe Claws
// -------------------------------------------------------------
module upper_leg() {
    mat_purple() {
        sphere(r=1.25);
        translate([0, 0, -1.8]) cylinder(r=1.15, h=2.0, center=true);
    }
    mat_tan() {
        translate([0, 0, -3.0]) sphere(r=0.9);
    }
}

module lower_leg() {
    mat_tan() {
        translate([0, 0, -1.8]) cylinder(r=0.85, h=2.2, center=true);
    }
    mat_cyan() {
        translate([0, 0, -3.2]) sphere(r=1.05);
        translate([0, 1.0, -3.8]) scale([1.0, 1.6, 0.75]) sphere(r=1.15);

        translate([0, 1.8, -4.15])
            rotate([-85, 0, 0]) cylinder(r1=0.36, r2=0.06, h=1.4);
        translate([0.48, 1.7, -4.15])
            rotate([-85, -12, 0]) cylinder(r1=0.34, r2=0.06, h=1.35);
        translate([-0.48, 1.7, -4.15])
            rotate([-85, 12, 0]) cylinder(r1=0.34, r2=0.06, h=1.35);
    }
    mat_blue_rim() {
        translate([0, -0.4, -4.1]) cylinder(r=0.45, h=0.7);
    }
}

// -------------------------------------------------------------
// Teacher Animations
// -------------------------------------------------------------
robot_anim = [
    ["Idle", [
        ["Root", [
            [0.0, [ -5, 0, 0], [0, 0, 13.0]],
            [1.0, [ -3, 0, 0], [0, 0, 13.4]],
            [2.0, [ -5, 0, 0], [0, 0, 13.0]]
        ]],
        ["LeftArm", [
            [0.0, [ 15, -30, 0]],
            [1.0, [ 12, -32, 0]],
            [2.0, [ 15, -30, 0]]
        ]],
        ["LeftForearm", [
            [0.0, [ 30, 0, 0]],
            [1.0, [ 35, 0, 0]],
            [2.0, [ 30, 0, 0]]
        ]],
        ["RightArm", [
            [0.0, [ 15, 30, 0]],
            [1.0, [ 12, 32, 0]],
            [2.0, [ 15, 30, 0]]
        ]],
        ["RightForearm", [
            [0.0, [ 30, 0, 0]],
            [1.0, [ 35, 0, 0]],
            [2.0, [ 30, 0, 0]]
        ]],
        ["LeftLeg",   [ [0.0, [ 15, 0, 6]] ]],
        ["LeftShin",  [ [0.0, [-15, 0, 0]] ]],
        ["RightLeg",  [ [0.0, [ 15, 0, -6]] ]],
        ["RightShin", [ [0.0, [-15, 0, 0]] ]]
    ]],

    ["Praise", [
        ["Root", [
            [0.0, [ -5, 0, 0], [0, 0, 13.0]],
            [0.3, [  0, 0, 0], [0, 0, 17.0]],
            [0.6, [ -5, 0, 0], [0, 0, 13.0]],
            [0.9, [  0, 0, 0], [0, 0, 17.0]],
            [1.2, [ -5, 0, 0], [0, 0, 13.0]]
        ]],
        ["LeftArm", [
            [0.0,  [ 15,  -30, 0]],
            [0.15, [ 15,  -90, 0]],
            [0.3,  [ 15, -150, 0]],
            [0.6,  [ 15, -150, 0]],
            [0.9,  [ 15, -150, 0]],
            [1.05, [ 15,  -90, 0]],
            [1.2,  [ 15,  -30, 0]]
        ]],
        ["LeftForearm", [
            [0.0, [ 30, 0, 0]],
            [0.3, [ 10, 0, 0]],
            [0.6, [ 10, 0, 0]],
            [0.9, [ 10, 0, 0]],
            [1.2, [ 30, 0, 0]]
        ]],
        ["RightArm", [
            [0.0,  [ 15,  30, 0]],
            [0.15, [ 15,  90, 0]],
            [0.3,  [ 15, 150, 0]],
            [0.6,  [ 15, 150, 0]],
            [0.9,  [ 15, 150, 0]],
            [1.05, [ 15,  90, 0]],
            [1.2,  [ 15,  30, 0]]
        ]],
        ["RightForearm", [
            [0.0, [ 30, 0, 0]],
            [0.3, [ 10, 0, 0]],
            [0.6, [ 10, 0, 0]],
            [0.9, [ 10, 0, 0]],
            [1.2, [ 30, 0, 0]]
        ]],
        ["LeftLeg", [
            [0.0, [ 15, 0,  6]],
            [0.3, [ 35, 0,  6]],
            [0.6, [ 15, 0,  6]],
            [0.9, [ 35, 0,  6]],
            [1.2, [ 15, 0,  6]]
        ]],
        ["LeftShin", [
            [0.0, [-15, 0, 0]],
            [0.3, [-45, 0, 0]],
            [0.6, [-15, 0, 0]],
            [0.9, [-45, 0, 0]],
            [1.2, [-15, 0, 0]]
        ]],
        ["RightLeg", [
            [0.0, [ 15, 0, -6]],
            [0.3, [ 35, 0, -6]],
            [0.6, [ 15, 0, -6]],
            [0.9, [ 35, 0, -6]],
            [1.2, [ 15, 0, -6]]
        ]],
        ["RightShin", [
            [0.0, [-15, 0, 0]],
            [0.3, [-45, 0, 0]],
            [0.6, [-15, 0, 0]],
            [0.9, [-45, 0, 0]],
            [1.2, [-15, 0, 0]]
        ]]
    ]]
];

armature(animations=robot_anim) {
    bone(name="Root", t=[0, 0, 13.0], r=[-5, 0, 0]) {
        robot_body();

        bone(name="LeftArm", t=[8.2, 0.5, 0.0], r=[15, -30, 0]) {
            arm_upper();
            bone(name="LeftForearm", t=[0, 0, -2.8], r=[30, 0, 0]) {
                arm_forearm();
            }
        }

        bone(name="RightArm", t=[-8.2, 0.5, 0.0], r=[15, 30, 0]) {
            arm_upper();
            bone(name="RightForearm", t=[0, 0, -2.8], r=[30, 0, 0]) {
                arm_forearm();
            }
        }

        bone(name="LeftLeg", t=[3.6, 0.0, -7.0], r=[15, 0, 6]) {
            upper_leg();
            bone(name="LeftShin", t=[0, 0, -3.0], r=[-15, 0, 0]) {
                lower_leg();
            }
        }

        bone(name="RightLeg", t=[-3.6, 0.0, -7.0], r=[15, 0, -6]) {
            upper_leg();
            bone(name="RightShin", t=[0, 0, -3.0], r=[-15, 0, 0]) {
                lower_leg();
            }
        }
    }
}
`,
);

writeFile(
  "assets/models/toy_blocks.scad",
  `/* Model Name: toy_blocks */
$fn = 24;
$asa = 45.0;

module toy_block(col) {
    color(col, metalness=0.05, roughness=0.50, $asa=45) {
        difference() {
            cube([0.22, 0.22, 0.22], center=true);
            for (rot = [[0,0,0], [90,0,0], [0,90,0], [-90,0,0], [0,-90,0], [180,0,0]]) {
                rotate(rot) translate([0, 0, 0.11]) cube([0.16, 0.16, 0.02], center=true);
            }
        }
    }
    color([0.90, 0.90, 0.92], metalness=0.0, roughness=0.35, $asa=45) {
        sphere(r=0.06);
    }
}

module toy_blocks() {
    translate([0, 0, 0.11])
        rotate([0, 0, 12])
        toy_block([0.85, 0.22, 0.25]);

    translate([0.24, -0.04, 0.11])
        rotate([0, 0, -15])
        toy_block([0.12, 0.65, 0.85]);

    translate([0.10, -0.02, 0.33])
        rotate([0, 0, 6])
        toy_block([0.92, 0.75, 0.15]);
}

toy_blocks();
`,
);

// -------------------------------------------------------------------------
// 2B. PARTICLE SVG TEXTURES (Stand-alone vector assets)
// -------------------------------------------------------------------------

writeFile(
  "assets/particles/confetti_star.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <polygon points="32,2 41,21 62,24 47,40 50,61 32,51 14,61 17,40 2,24 23,21" fill="#FFFFFF"/>
</svg>`,
);

writeFile(
  "assets/particles/confetti_ribbon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24" viewBox="0 0 48 24">
  <rect x="2" y="3" width="44" height="18" rx="7" ry="7" fill="#FFFFFF"/>
</svg>`,
);

writeFile(
  "assets/particles/sparkle.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <path d="M32,0 Q32,32 64,32 Q32,32 32,64 Q32,32 0,32 Q32,32 32,0 Z" fill="#FFFFFF"/>
</svg>`,
);

// -------------------------------------------------------------------------
// 3. GDSCRIPT LOGIC
// -------------------------------------------------------------------------

writeFile(
  "scripts/sound_manager.gd",
  `class_name SoundManager
extends Node

var audio_players: Array[AudioStreamPlayer] = []
var max_polyphony: int = 8
var current_player: int = 0
var is_muted: bool = false

var chime_streams: Array[AudioStreamWAV] = []
var chalk_stream: AudioStreamWAV
var fanfare_stream: AudioStreamWAV
var pop_stream: AudioStreamWAV
var chatter_streams: Array[AudioStreamWAV] = []

func _ready() -> void:
	for i in range(max_polyphony):
		var player = AudioStreamPlayer.new()
		add_child(player)
		audio_players.append(player)
	_generate_audio_assets()

func _generate_audio_assets() -> void:
	var pentatonic_notes = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51]
	for freq in pentatonic_notes:
		chime_streams.append(_synthesize_bell(freq, 0.55))

	chalk_stream = _synthesize_chalk_stroke()
	fanfare_stream = _synthesize_fanfare()
	pop_stream = _synthesize_pop()

	for pitch in [620.0, 780.0, 950.0, 1100.0]:
		chatter_streams.append(_synthesize_robot_blip(pitch))

func _play_stream(stream: AudioStreamWAV, volume_db: float = 0.0) -> void:
	if is_muted or stream == null:
		return
	var player = audio_players[current_player]
	current_player = (current_player + 1) % max_polyphony
	player.stream = stream
	player.volume_db = volume_db
	player.play()

func play_chime(index: int) -> void:
	if chime_streams.is_empty():
		return
	var idx = clamp(index, 0, chime_streams.size() - 1)
	_play_stream(chime_streams[idx], -3.0)

func play_chalk() -> void:
	_play_stream(chalk_stream, -14.0)

func play_fanfare() -> void:
	_play_stream(fanfare_stream, 0.0)

func play_pop() -> void:
	_play_stream(pop_stream, -4.0)

func play_robot_voice() -> void:
	if chatter_streams.is_empty():
		return
	var idx = randi() % chatter_streams.size()
	_play_stream(chatter_streams[idx], -6.0)

func toggle_mute() -> bool:
	is_muted = !is_muted
	return is_muted

func _synthesize_bell(freq: float, duration: float) -> AudioStreamWAV:
	var sample_rate = 22050
	var num_samples = int(duration * sample_rate)
	var samples = PackedFloat32Array()
	samples.resize(num_samples)
	var two_pi = TAU

	for i in range(num_samples):
		var t = float(i) / float(sample_rate)
		var env = exp(-t * 5.5)
		var s1 = sin(two_pi * freq * t)
		var s2 = 0.35 * sin(two_pi * (freq * 2.0) * t)
		var s3 = 0.15 * sin(two_pi * (freq * 3.0) * t)
		samples[i] = (s1 + s2 + s3) * env * 0.75

	return _pack_wav(samples, sample_rate)

func _synthesize_pop() -> AudioStreamWAV:
	var sample_rate = 22050
	var duration = 0.08
	var num_samples = int(duration * sample_rate)
	var samples = PackedFloat32Array()
	samples.resize(num_samples)

	for i in range(num_samples):
		var t = float(i) / float(sample_rate)
		var progress = t / duration
		var freq = lerp(680.0, 140.0, progress)
		var env = 1.0 - progress
		samples[i] = sin(TAU * freq * t) * env * 0.8

	return _pack_wav(samples, sample_rate)

func _synthesize_chalk_stroke() -> AudioStreamWAV:
	var sample_rate = 22050
	var duration = 0.09
	var num_samples = int(duration * sample_rate)
	var samples = PackedFloat32Array()
	samples.resize(num_samples)

	var noise_prev = 0.0
	for i in range(num_samples):
		var t = float(i) / float(sample_rate)
		var env = sin((t / duration) * PI)
		var white = (randf() * 2.0 - 1.0)
		noise_prev = lerp(noise_prev, white, 0.35)
		samples[i] = noise_prev * env * 0.5

	return _pack_wav(samples, sample_rate)

func _synthesize_robot_blip(freq: float) -> AudioStreamWAV:
	var sample_rate = 22050
	var duration = 0.12
	var num_samples = int(duration * sample_rate)
	var samples = PackedFloat32Array()
	samples.resize(num_samples)

	for i in range(num_samples):
		var t = float(i) / float(sample_rate)
		var env = sin((t / duration) * PI)
		var chirp = freq + sin(TAU * 35.0 * t) * 70.0
		samples[i] = sin(TAU * chirp * t) * env * 0.65

	return _pack_wav(samples, sample_rate)

func _synthesize_fanfare() -> AudioStreamWAV:
	var sample_rate = 22050
	var duration = 1.25
	var num_samples = int(duration * sample_rate)
	var samples = PackedFloat32Array()
	samples.resize(num_samples)

	var arpeggio = [523.25, 659.25, 783.99, 1046.50, 1318.51]
	for i in range(num_samples):
		var t = float(i) / float(sample_rate)
		var note_idx = int(clamp(t / 0.18, 0, arpeggio.size() - 1))
		var note_freq = arpeggio[note_idx]
		var note_local_t = fmod(t, 0.18)
		if note_idx == arpeggio.size() - 1:
			note_local_t = t - (0.18 * 4.0)

		var env = exp(-note_local_t * 3.5)
		var s = sin(TAU * note_freq * t) + 0.3 * sin(TAU * (note_freq * 2.0) * t)
		samples[i] = s * env * 0.7

	return _pack_wav(samples, sample_rate)

func _pack_wav(samples: PackedFloat32Array, sample_rate: int) -> AudioStreamWAV:
	var wav = AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = sample_rate
	wav.stereo = false
	var byte_data = PackedByteArray()
	byte_data.resize(samples.size() * 2)

	for i in range(samples.size()):
		var val = clampf(samples[i], -1.0, 1.0)
		var s16 = int(val * 32767.0)
		byte_data.encode_s16(i * 2, s16)

	wav.data = byte_data
	return wav
`,
);

writeFile(
  "scripts/digit_data.gd",
  `class_name DigitData
extends RefCounted

static func get_digit_info(digit: int) -> Dictionary:
	match digit:
		0:
			return {
				"digit": 0,
				"name": "Zero",
				"rhyme": "Around and around and around we go,\\nwhen we get home we have a zero!",
				"tip": "Start at the upper right! Curve up and left all the way around, and join back at the start!",
				"strokes": [
					[
						Vector2(0.68, 0.26), # Start: upper-right with arrow pointing up-left
						Vector2(0.50, 0.16), # Top center
						Vector2(0.32, 0.22), # Upper-left curve
						Vector2(0.24, 0.40), # Mid-left
						Vector2(0.24, 0.60), # Lower-left
						Vector2(0.32, 0.78), # Bottom-left curve
						Vector2(0.50, 0.84), # Bottom center
						Vector2(0.68, 0.78), # Bottom-right curve
						Vector2(0.76, 0.60), # Lower-right
						Vector2(0.76, 0.40), # Mid-right
						Vector2(0.68, 0.26)  # Return to upper-right start
					]
				]
			}
		1:
			return {
				"digit": 1,
				"name": "One",
				"rhyme": "Number one is like a stick,\\na straight line down that's very quick!",
				"tip": "Start at the top and slide straight down!",
				"strokes": [
					[
						Vector2(0.40, 0.28),
						Vector2(0.50, 0.16),
						Vector2(0.50, 0.40),
						Vector2(0.50, 0.64),
						Vector2(0.50, 0.84)
					]
				]
			}
		2:
			return {
				"digit": 2,
				"name": "Two",
				"rhyme": "Around and back on the railroad track,\\ntwo, two, two!",
				"tip": "Curve around the top, slide down, and across!",
				"strokes": [
					[
						Vector2(0.30, 0.28),
						Vector2(0.45, 0.16),
						Vector2(0.66, 0.20),
						Vector2(0.70, 0.35),
						Vector2(0.55, 0.55),
						Vector2(0.32, 0.84),
						Vector2(0.52, 0.84),
						Vector2(0.72, 0.84)
					]
				]
			}
		3:
			return {
				"digit": 3,
				"name": "Three",
				"rhyme": "Around the tree and around the tree,\\nthat's the way we make a three!",
				"tip": "Make two bouncy hops to the right!",
				"strokes": [
					[
						Vector2(0.32, 0.22),
						Vector2(0.50, 0.16),
						Vector2(0.68, 0.24),
						Vector2(0.64, 0.42),
						Vector2(0.48, 0.48),
						Vector2(0.66, 0.58),
						Vector2(0.70, 0.74),
						Vector2(0.52, 0.84),
						Vector2(0.32, 0.78)
					]
				]
			}
		4:
			return {
				"digit": 4,
				"name": "Four",
				"rhyme": "Down and over, down once more,\\nthat's the way we make a four!",
				"tip": "Two strokes! First an L, then a straight stick!",
				"strokes": [
					[
						Vector2(0.64, 0.16),
						Vector2(0.45, 0.42),
						Vector2(0.28, 0.64),
						Vector2(0.50, 0.64),
						Vector2(0.74, 0.64)
					],
					[
						Vector2(0.64, 0.38),
						Vector2(0.64, 0.64),
						Vector2(0.64, 0.84)
					]
				]
			}
		5:
			return {
				"digit": 5,
				"name": "Five",
				"rhyme": "Straight line down, around we go,\\nput on a hat for number five, oh!",
				"tip": "Down the neck, around the belly, then the hat!",
				"strokes": [
					[
						Vector2(0.38, 0.20),
						Vector2(0.36, 0.44),
						Vector2(0.56, 0.44),
						Vector2(0.72, 0.56),
						Vector2(0.70, 0.74),
						Vector2(0.54, 0.84),
						Vector2(0.34, 0.80)
					],
					[
						Vector2(0.38, 0.20),
						Vector2(0.54, 0.20),
						Vector2(0.70, 0.20)
					]
				]
			}
		6:
			return {
				"digit": 6,
				"name": "Six",
				"rhyme": "Down to a loop,\\na six rolls in a hoop!",
				"tip": "Slide down and roll inside a cozy loop!",
				"strokes": [
					[
						Vector2(0.64, 0.16),
						Vector2(0.42, 0.30),
						Vector2(0.28, 0.54),
						Vector2(0.32, 0.76),
						Vector2(0.50, 0.84),
						Vector2(0.70, 0.74),
						Vector2(0.70, 0.56),
						Vector2(0.50, 0.50),
						Vector2(0.30, 0.60)
					]
				]
			}
		7:
			return {
				"digit": 7,
				"name": "Seven",
				"rhyme": "Across the sky and down from heaven,\\nadd a belt to make a seven!",
				"tip": "Two strokes! Slide across, slant down, and draw a belt across the middle!",
				"strokes": [
					[
						Vector2(0.28, 0.18),
						Vector2(0.50, 0.18),
						Vector2(0.74, 0.18),
						Vector2(0.60, 0.42),
						Vector2(0.48, 0.64),
						Vector2(0.38, 0.84)
					],
					[
						Vector2(0.42, 0.52),
						Vector2(0.66, 0.52)
					]
				]
			}
		8:
			return {
				"digit": 8,
				"name": "Eight",
				"rhyme": "Make an S and do not wait,\\nclimb back up to make an eight!",
				"tip": "Start at the upper right! Curve up and left, cross down like an S, loop the bottom, and climb back home!",
				"strokes": [
					[
						Vector2(0.64, 0.22), # Start: upper-right with arrow up-left
						Vector2(0.50, 0.16), # Top center
						Vector2(0.34, 0.24), # Upper-left curve
						Vector2(0.36, 0.38), # Mid-left
						Vector2(0.50, 0.48), # Center crossover
						Vector2(0.64, 0.60), # Bottom loop upper-right
						Vector2(0.66, 0.76), # Bottom loop lower-right
						Vector2(0.50, 0.84), # Bottom center
						Vector2(0.34, 0.78), # Bottom loop lower-left
						Vector2(0.34, 0.62), # Bottom loop upper-left
						Vector2(0.50, 0.48), # Cross center waist again
						Vector2(0.64, 0.22)  # Return to start point
					]
				]
			}
		9:
			return {
				"digit": 9,
				"name": "Nine",
				"rhyme": "Make a loop and come back round,\\nslide down and curl along the ground!",
				"tip": "Start at the upper right! Loop up and around, slide straight down, and curl the tail to the left!",
				"strokes": [
					[
						Vector2(0.66, 0.24), # Start: upper-right with arrow up-left
						Vector2(0.50, 0.16), # Top crest
						Vector2(0.34, 0.26), # Upper-left of oval
						Vector2(0.34, 0.42), # Lower-left of oval
						Vector2(0.50, 0.50), # Bottom of oval
						Vector2(0.66, 0.42), # Lower-right of oval
						Vector2(0.66, 0.24), # Connect back to start
						Vector2(0.66, 0.52), # Slide down the stem
						Vector2(0.62, 0.72), # Slant down towards baseline
						Vector2(0.50, 0.84), # Curve onto bottom line
						Vector2(0.36, 0.84), # Bottom tail curling left
						Vector2(0.24, 0.84)  # Tail tip finish
					]
				]
			}
		_:
			return get_digit_info(0)
`,
);

writeFile(
  "scripts/teacher_robot.gd",
  `class_name TeacherRobot
extends Node3D

signal speech_requested(text: String)

@export var look_target_node: Node3D
var anim_player: AnimationPlayer = null

var base_rotation_y: float = deg_to_rad(215.0)
var target_turn_y: float = 0.0
var base_position_y: float = 0.08
var idle_timer: float = 0.0
var is_praising: bool = false
var is_grounded: bool = false

func _ready() -> void:
	rotation.y = base_rotation_y
	position.y = base_position_y
	_find_animation_player(self)
	if anim_player:
		anim_player.animation_finished.connect(_on_anim_finished)
	play_idle()
	_ground_to_floor()

func _ground_to_floor() -> void:
	await get_tree().process_frame

	var min_y = INF
	var visual_nodes = find_children("*", "VisualInstance3D", true)
	for node in visual_nodes:
		if node is VisualInstance3D:
			var aabb = node.get_aabb()
			if aabb.size.length_squared() < 0.0001:
				continue
			var trans = node.global_transform
			for i in range(8):
				var corner = aabb.get_endpoint(i)
				var world_corner = trans * corner
				min_y = minf(min_y, world_corner.y)

	if min_y < INF and absf(min_y) > 0.001:
		position.y -= min_y
	elif min_y == INF:
		position.y = 0.08

	base_position_y = position.y
	is_grounded = true

func _find_animation_player(node: Node) -> void:
	if node is AnimationPlayer:
		anim_player = node
		return
	for child in node.get_children():
		_find_animation_player(child)
		if anim_player != null:
			return

func play_idle() -> void:
	is_praising = false
	target_turn_y = 0.0
	if anim_player and anim_player.has_animation("Idle"):
		var anim = anim_player.get_animation("Idle")
		if anim:
			anim.loop_mode = Animation.LOOP_LINEAR
		anim_player.play("Idle")

func play_praise() -> void:
	is_praising = true
	target_turn_y = deg_to_rad(-15.0)
	if anim_player and anim_player.has_animation("Praise"):
		anim_player.play("Praise")
	else:
		var tween = create_tween()
		tween.tween_property(self, "position:y", base_position_y + 0.25, 0.25).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tween.tween_property(self, "position:y", base_position_y, 0.25).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
		tween.tween_callback(func(): is_praising = false)

func _on_anim_finished(anim_name: StringName) -> void:
	if anim_name == "Praise":
		play_idle()
	elif anim_name == "Idle" and not is_praising:
		if anim_player and anim_player.has_animation("Idle"):
			anim_player.play("Idle")

func _process(delta: float) -> void:
	idle_timer += delta

	if not is_praising and is_grounded:
		position.y = lerp(position.y, base_position_y, delta * 8.0)

	rotation.y = lerp_angle(rotation.y, base_rotation_y + target_turn_y, delta * 4.0)

func look_at_canvas(turn: bool) -> void:
	if is_praising:
		return
	target_turn_y = deg_to_rad(15.0) if turn else 0.0
`,
);

writeFile(
  "scripts/writing_canvas.gd",
  `class_name WritingCanvas
extends Control

signal checkpoint_hit(pos: Vector2, index: int)
signal digit_completed(stars: int)
signal stroke_started()
signal stroke_finished()
signal demo_finished()

var hit_radius: float = 46.0
var line_width: float = 18.0
var guide_visible: bool = true

var digit_data: Dictionary = {}
var strokes_target: Array = []
var active_stroke_idx: int = 0
var active_checkpoint_idx: int = 0
var completed_checkpoints: Array = []

var drawn_strokes: Array = []
var current_stroke: PackedVector2Array = PackedVector2Array()
var is_drawing: bool = false
var brush_color: Color = Color(0.2, 0.85, 1.0)

var is_demo_playing: bool = false
var demo_timer: float = 0.0
var demo_stylus_pos: Vector2 = Vector2.ZERO

var pulse_time: float = 0.0
var recent_hit_anim: float = 0.0

func _ready() -> void:
	set_process(true)
	queue_redraw()

func load_digit(data: Dictionary) -> void:
	digit_data = data
	strokes_target = data.get("strokes", [])
	reset_canvas()

func reset_canvas() -> void:
	drawn_strokes.clear()
	current_stroke.clear()
	completed_checkpoints.clear()
	active_stroke_idx = 0
	active_checkpoint_idx = 0
	is_drawing = false
	is_demo_playing = false
	queue_redraw()

func undo_last_stroke() -> void:
	if drawn_strokes.size() > 0:
		drawn_strokes.pop_back()
		if active_stroke_idx > 0:
			active_stroke_idx -= 1
			active_checkpoint_idx = 0
			_recompute_completed_checkpoints()
		else:
			completed_checkpoints.clear()
			active_checkpoint_idx = 0
		queue_redraw()

func _recompute_completed_checkpoints() -> void:
	completed_checkpoints.clear()
	for s_idx in range(active_stroke_idx):
		if s_idx < strokes_target.size():
			var pts = strokes_target[s_idx]
			for pt in pts:
				completed_checkpoints.append(pt * size)

func start_demo() -> void:
	reset_canvas()
	is_demo_playing = true
	demo_timer = 0.0

func set_brush_color(col: Color) -> void:
	brush_color = col
	queue_redraw()

func toggle_guides() -> bool:
	guide_visible = !guide_visible
	queue_redraw()
	return guide_visible

func _gui_input(event: InputEvent) -> void:
	if is_demo_playing:
		return

	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_start_drawing(event.position)
			else:
				_finish_drawing()
	elif event is InputEventMouseMotion and is_drawing:
		_add_drawing_point(event.position)
	elif event is InputEventScreenTouch:
		if event.pressed:
			_start_drawing(event.position)
		else:
			_finish_drawing()
	elif event is InputEventScreenDrag and is_drawing:
		_add_drawing_point(event.position)

func _start_drawing(pos: Vector2) -> void:
	is_drawing = true
	current_stroke = PackedVector2Array([pos])
	_check_checkpoint_proximity(pos)
	stroke_started.emit()
	queue_redraw()

func _add_drawing_point(pos: Vector2) -> void:
	if current_stroke.is_empty():
		current_stroke.append(pos)
	else:
		var last_pt = current_stroke[current_stroke.size() - 1]
		if last_pt.distance_squared_to(pos) >= 16.0:
			current_stroke.append(pos)
			_check_checkpoint_proximity(pos)
			queue_redraw()

func _finish_drawing() -> void:
	if is_drawing and current_stroke.size() > 0:
		drawn_strokes.append(current_stroke)
		current_stroke = PackedVector2Array()
	is_drawing = false
	stroke_finished.emit()
	queue_redraw()

func _check_checkpoint_proximity(pos: Vector2) -> void:
	if active_stroke_idx >= strokes_target.size():
		return

	var current_stroke_checkpoints = strokes_target[active_stroke_idx]
	if active_checkpoint_idx >= current_stroke_checkpoints.size():
		return

	var target_norm = current_stroke_checkpoints[active_checkpoint_idx]
	var target_px = target_norm * size

	if pos.distance_to(target_px) <= hit_radius:
		completed_checkpoints.append(target_px)
		checkpoint_hit.emit(target_px, active_checkpoint_idx)
		recent_hit_anim = 1.0

		active_checkpoint_idx += 1
		if active_checkpoint_idx >= current_stroke_checkpoints.size():
			active_stroke_idx += 1
			active_checkpoint_idx = 0

			if active_stroke_idx >= strokes_target.size():
				var stars = _calculate_stars()
				digit_completed.emit(stars)

func _calculate_stars() -> int:
	var total_checkpoints = 0
	for stroke in strokes_target:
		total_checkpoints += stroke.size()
	if completed_checkpoints.size() >= total_checkpoints:
		return 3
	elif completed_checkpoints.size() >= int(total_checkpoints * 0.75):
		return 2
	return 1

func _process(delta: float) -> void:
	pulse_time += delta
	if recent_hit_anim > 0.0:
		recent_hit_anim = max(0.0, recent_hit_anim - delta * 3.0)

	if is_demo_playing:
		_process_demo(delta)

	queue_redraw()

func _process_demo(delta: float) -> void:
	if strokes_target.is_empty():
		is_demo_playing = false
		return

	var current_stroke_pts = strokes_target[active_stroke_idx]
	var total_pts = current_stroke_pts.size()
	demo_timer += delta * 1.8

	var step_idx = int(demo_timer)
	var fract = fmod(demo_timer, 1.0)

	if step_idx < total_pts - 1:
		var p0 = current_stroke_pts[step_idx] * size
		var p1 = current_stroke_pts[step_idx + 1] * size
		demo_stylus_pos = p0.lerp(p1, fract)

		if current_stroke.is_empty():
			current_stroke.append(demo_stylus_pos)
		else:
			current_stroke.append(demo_stylus_pos)

		if fract < 0.15 and active_checkpoint_idx == step_idx:
			completed_checkpoints.append(p0)
			checkpoint_hit.emit(p0, step_idx)
			active_checkpoint_idx += 1
	else:
		var last_pt = current_stroke_pts[total_pts - 1] * size
		demo_stylus_pos = last_pt
		completed_checkpoints.append(last_pt)
		checkpoint_hit.emit(last_pt, total_pts - 1)
		drawn_strokes.append(current_stroke)
		current_stroke = PackedVector2Array()

		active_stroke_idx += 1
		active_checkpoint_idx = 0
		demo_timer = 0.0

		if active_stroke_idx >= strokes_target.size():
			is_demo_playing = false
			demo_finished.emit()

func _draw() -> void:
	var canvas_rect = Rect2(Vector2.ZERO, size)

	draw_rect(canvas_rect, Color(0.10, 0.14, 0.18), true)
	var line_color = Color(1.0, 1.0, 1.0, 0.10)
	draw_line(Vector2(0, size.y * 0.16), Vector2(size.x, size.y * 0.16), line_color, 2.0)
	draw_dashed_line(Vector2(0, size.y * 0.50), Vector2(size.x, size.y * 0.50), Color(0.3, 0.7, 1.0, 0.20), 3.0, 10.0)
	draw_line(Vector2(0, size.y * 0.84), Vector2(size.x, size.y * 0.84), line_color, 2.0)

	if guide_visible:
		for s_idx in range(strokes_target.size()):
			var pts = strokes_target[s_idx]
			for i in range(pts.size() - 1):
				var p1 = pts[i] * size
				var p2 = pts[i + 1] * size
				var guide_color = Color(0.9, 0.9, 1.0, 0.25)
				if s_idx == active_stroke_idx:
					guide_color = Color(1.0, 0.9, 0.3, 0.50)
				draw_dashed_line(p1, p2, guide_color, 4.0, 8.0)
				var mid = p1.lerp(p2, 0.5)
				var dir = (p2 - p1).normalized()
				var normal = Vector2(-dir.y, dir.x)
				draw_line(mid - dir * 6 + normal * 6, mid, guide_color, 3.0)
				draw_line(mid - dir * 6 - normal * 6, mid, guide_color, 3.0)

	for stroke in drawn_strokes:
		_draw_chalk_line(stroke, brush_color)

	if current_stroke.size() > 1:
		_draw_chalk_line(current_stroke, brush_color)

	if guide_visible:
		var default_font = get_theme_default_font()
		for s_idx in range(strokes_target.size()):
			var pts = strokes_target[s_idx]
			for i in range(pts.size()):
				var pt = pts[i] * size
				var is_completed = completed_checkpoints.has(pt)
				var is_next = (s_idx == active_stroke_idx and i == active_checkpoint_idx)

				if is_completed:
					draw_circle(pt, 12.0, Color(0.2, 0.85, 0.4, 0.9))
					draw_circle(pt, 6.0, Color(1.0, 1.0, 1.0, 0.9))
				elif is_next:
					var pulse = 1.0 + sin(pulse_time * 6.0) * 0.18
					draw_circle(pt, hit_radius * 0.42 * pulse, Color(1.0, 0.85, 0.2, 0.35))
					draw_circle(pt, 14.0 * pulse, Color(1.0, 0.85, 0.15))
					draw_circle(pt, 7.0, Color(1.0, 1.0, 1.0))
					if i == 0 and default_font:
						draw_string(default_font, pt + Vector2(-4, -18), str(s_idx + 1), HORIZONTAL_ALIGNMENT_CENTER, -1, 16, Color(1, 1, 0.3))
				else:
					draw_circle(pt, 8.0, Color(1.0, 1.0, 1.0, 0.25))

	if is_demo_playing:
		draw_circle(demo_stylus_pos, 16.0, Color(1.0, 0.4, 0.2, 0.7))
		draw_circle(demo_stylus_pos, 8.0, Color(0.2, 0.9, 1.0))

func _draw_chalk_line(points: PackedVector2Array, col: Color) -> void:
	if points.size() < 2:
		return
	draw_polyline(points, Color(col.r, col.g, col.b, 0.35), line_width + 8.0, true)
	draw_polyline(points, col, line_width, true)
	draw_circle(points[0], line_width * 0.5, col)
	draw_circle(points[points.size() - 1], line_width * 0.5, col)
`,
);

writeFile(
  "scripts/main_game.gd",
  `class_name MainGame
extends Node3D

@onready var sound_manager: SoundManager = $SoundManager
@onready var teacher_robot: TeacherRobot = $World3D/MouseRobot
@onready var toy_blocks: Node3D = $World3D/ToyBlocks

@onready var writing_canvas: WritingCanvas = $CanvasLayer/UI/MainHBox/BoardContainer/BoardPanel/WritingCanvas
@onready var speech_label: Label = $CanvasLayer/UI/SpeechBalloon/BalloonMargin/VBox/SpeechText
@onready var speech_balloon: Control = $CanvasLayer/UI/SpeechBalloon
@onready var celebration_modal: Control = $CanvasLayer/CelebrationModal
@onready var digit_title: Label = $CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/DigitTitle
@onready var star_count_label: Label = $CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/StarDisplay/StarMargin/HBox/StarLabel
@onready var star_icon: Control = $CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/StarDisplay/StarMargin/HBox/StarIcon
@onready var star_rating_box: Control = $CanvasLayer/CelebrationModal/ModalPanel/VBox/StarRatingBox
@onready var digit_btn_container: HBoxContainer = $CanvasLayer/UI/BottomBar/DigitScroll/DigitHBox
@onready var confetti_stars: CPUParticles2D = $CanvasLayer/ConfettiStars
@onready var confetti_ribbons: CPUParticles2D = $CanvasLayer/ConfettiRibbons
@onready var checkpoint_sparkles: CPUParticles2D = $CanvasLayer/CheckpointSparkles
@onready var tools_bar: HBoxContainer = $CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar

var current_digit: int = 1
var stars_earned_map: Dictionary = {}
var total_stars: int = 0
var current_modal_stars: int = 3

var chalk_colors = [
	{"name": "ColorCyan", "color": Color(0.20, 0.85, 1.00)},
	{"name": "ColorYellow", "color": Color(1.00, 0.88, 0.20)},
	{"name": "ColorPink", "color": Color(1.00, 0.45, 0.70)},
	{"name": "ColorGreen", "color": Color(0.35, 0.95, 0.35)},
	{"name": "ColorWhite", "color": Color(0.96, 0.96, 0.98)}
]
var active_color_index: int = 0

func _ready() -> void:
	teacher_robot.rotation_degrees.y = 215.0
	teacher_robot.position = Vector3(-0.85, 0.08, -0.2)

	toy_blocks.rotation_degrees.y = 180.0
	toy_blocks.position = Vector3(-1.15, 0.0, 0.15)

	if star_icon:
		star_icon.draw.connect(_on_star_icon_draw)
	if star_rating_box:
		star_rating_box.draw.connect(_on_star_rating_box_draw)

	_setup_particle_textures()
	_init_star_map()
	_create_digit_buttons()
	_setup_color_swatches()
	_load_digit(1)

	writing_canvas.checkpoint_hit.connect(_on_checkpoint_hit)
	writing_canvas.digit_completed.connect(_on_digit_completed)
	writing_canvas.stroke_started.connect(_on_stroke_started)
	writing_canvas.stroke_finished.connect(_on_stroke_finished)
	writing_canvas.demo_finished.connect(_on_demo_finished)

func _setup_particle_textures() -> void:
	var star_tex = _generate_star_texture(36)
	var ribbon_tex = _generate_ribbon_texture(30, 14)
	var sparkle_tex = _generate_sparkle_texture(32)

	if confetti_stars:
		confetti_stars.texture = star_tex
	if confetti_ribbons:
		confetti_ribbons.texture = ribbon_tex
	if checkpoint_sparkles:
		checkpoint_sparkles.texture = sparkle_tex

func _init_star_map() -> void:
	for d in range(10):
		stars_earned_map[d] = 0

func _create_digit_buttons() -> void:
	for child in digit_btn_container.get_children():
		child.queue_free()

	# Order: 1 through 9, followed by 0
	var order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
	for d in order:
		var btn = Button.new()
		btn.text = str(d)
		btn.custom_minimum_size = Vector2(64, 60)
		btn.add_theme_font_size_override("font_size", 28)
		btn.focus_mode = Control.FOCUS_NONE
		btn.pressed.connect(func(): _load_digit(d))
		digit_btn_container.add_child(btn)

func _setup_color_swatches() -> void:
	for i in range(chalk_colors.size()):
		var info = chalk_colors[i]
		var btn = tools_bar.get_node_or_null(info.name) as Button
		if btn:
			btn.text = ""
			btn.custom_minimum_size = Vector2(36, 36)
			var idx = i
			btn.pressed.connect(func(): _on_color_swatch_selected(idx))
	_update_color_swatches_ui()

func _on_color_swatch_selected(idx: int) -> void:
	sound_manager.play_pop()
	active_color_index = idx
	writing_canvas.set_brush_color(chalk_colors[idx].color)
	_update_color_swatches_ui()

func _update_color_swatches_ui() -> void:
	for i in range(chalk_colors.size()):
		var info = chalk_colors[i]
		var btn = tools_bar.get_node_or_null(info.name) as Button
		if not btn:
			continue
		var is_active = (i == active_color_index)
		var style = StyleBoxFlat.new()
		style.set_corner_radius_all(18)
		style.bg_color = info.color
		if is_active:
			style.border_width_left = 3
			style.border_width_top = 3
			style.border_width_right = 3
			style.border_width_bottom = 3
			style.border_color = Color.WHITE
			style.shadow_size = 4
			style.shadow_color = Color(1, 1, 1, 0.4)
		else:
			style.border_width_left = 1
			style.border_width_top = 1
			style.border_width_right = 1
			style.border_width_bottom = 1
			style.border_color = Color(1, 1, 1, 0.25)
		btn.add_theme_stylebox_override("normal", style)
		btn.add_theme_stylebox_override("hover", style)
		btn.add_theme_stylebox_override("pressed", style)

func _load_digit(d: int) -> void:
	current_digit = d
	var data = DigitData.get_digit_info(d)
	writing_canvas.load_digit(data)

	digit_title.text = "Trace Number " + str(d) + "!"
	_set_speech(data.rhyme)
	sound_manager.play_pop()
	sound_manager.play_robot_voice()
	_update_digit_buttons_ui()

func _update_digit_buttons_ui() -> void:
	var buttons = digit_btn_container.get_children()
	for btn in buttons:
		if not btn is Button:
			continue
		var digit_val = int(btn.text)
		var is_active = (digit_val == current_digit)
		var stars = stars_earned_map.get(digit_val, 0)

		var style = StyleBoxFlat.new()
		style.set_corner_radius_all(12)
		if is_active:
			style.bg_color = Color(0.18, 0.45, 0.75, 0.95)
			style.border_width_left = 3
			style.border_width_top = 3
			style.border_width_right = 3
			style.border_width_bottom = 3
			style.border_color = Color(1.0, 0.85, 0.25, 1.0)
			btn.add_theme_color_override("font_color", Color(1.0, 0.95, 0.35))
		elif stars > 0:
			style.bg_color = Color(0.14, 0.24, 0.22, 0.90)
			style.border_width_left = 2
			style.border_width_top = 2
			style.border_width_right = 2
			style.border_width_bottom = 2
			style.border_color = Color(0.25, 0.70, 0.45, 0.7)
			btn.add_theme_color_override("font_color", Color(0.65, 0.95, 0.75))
		else:
			style.bg_color = Color(0.16, 0.20, 0.26, 0.90)
			style.border_width_left = 2
			style.border_width_top = 2
			style.border_width_right = 2
			style.border_width_bottom = 2
			style.border_color = Color(0.28, 0.34, 0.42, 0.7)
			btn.add_theme_color_override("font_color", Color(0.85, 0.90, 0.95))

		btn.add_theme_stylebox_override("normal", style)
		btn.add_theme_stylebox_override("hover", style)
		btn.add_theme_stylebox_override("pressed", style)

func _set_speech(text: String) -> void:
	speech_label.text = text
	speech_balloon.visible = true
	speech_balloon.scale = Vector2(0.85, 0.85)
	var tween = create_tween()
	tween.tween_property(speech_balloon, "scale", Vector2.ONE, 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

func _on_stroke_started() -> void:
	sound_manager.play_chalk()
	teacher_robot.look_at_canvas(true)

func _on_stroke_finished() -> void:
	teacher_robot.look_at_canvas(false)

func _on_checkpoint_hit(pos: Vector2, index: int) -> void:
	sound_manager.play_chime(index)
	_spawn_checkpoint_sparkles(pos)

func _spawn_checkpoint_sparkles(canvas_local_pos: Vector2) -> void:
	if not checkpoint_sparkles:
		return
	checkpoint_sparkles.global_position = writing_canvas.global_position + canvas_local_pos
	checkpoint_sparkles.restart()
	checkpoint_sparkles.emitting = true

func _on_demo_finished() -> void:
	var tween = create_tween()
	tween.tween_interval(1.5)
	tween.tween_callback(func():
		if not writing_canvas.is_demo_playing:
			writing_canvas.reset_canvas()
	)

func _on_digit_completed(stars: int) -> void:
	stars_earned_map[current_digit] = max(stars_earned_map[current_digit], stars)
	_recalculate_stars()

	sound_manager.play_fanfare()
	sound_manager.play_robot_voice()
	teacher_robot.play_praise()

	_trigger_celebration_confetti()

	var data = DigitData.get_digit_info(current_digit)
	_show_celebration(stars, data.rhyme)

func _trigger_celebration_confetti() -> void:
	if confetti_stars:
		confetti_stars.restart()
		confetti_stars.emitting = true
	if confetti_ribbons:
		confetti_ribbons.restart()
		confetti_ribbons.emitting = true

func _recalculate_stars() -> void:
	total_stars = 0
	for d in range(10):
		total_stars += stars_earned_map[d]
	star_count_label.text = str(total_stars) + " / 30"
	_update_digit_buttons_ui()

func _show_celebration(stars: int, rhyme: String) -> void:
	current_modal_stars = stars
	speech_balloon.visible = false

	var modal_rhyme_label = $CanvasLayer/CelebrationModal/ModalPanel/VBox/RhymeText
	modal_rhyme_label.text = rhyme
	star_rating_box.queue_redraw()

	celebration_modal.visible = true
	celebration_modal.scale = Vector2(0.6, 0.6)
	var tween = create_tween()
	tween.tween_property(celebration_modal, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)

func _on_next_pressed() -> void:
	sound_manager.play_pop()
	celebration_modal.visible = false
	var next_d = (current_digit + 1) % 10
	_load_digit(next_d)

func _on_replay_pressed() -> void:
	sound_manager.play_pop()
	celebration_modal.visible = false
	writing_canvas.reset_canvas()
	teacher_robot.play_idle()
	speech_balloon.visible = true

func _on_demo_btn_pressed() -> void:
	sound_manager.play_pop()
	sound_manager.play_robot_voice()
	var data = DigitData.get_digit_info(current_digit)
	_set_speech("Watch closely! " + data.tip)
	writing_canvas.start_demo()

func _on_clear_btn_pressed() -> void:
	sound_manager.play_pop()
	writing_canvas.reset_canvas()

func _on_undo_btn_pressed() -> void:
	sound_manager.play_pop()
	writing_canvas.undo_last_stroke()

func _on_audio_toggle_pressed() -> void:
	var muted = sound_manager.toggle_mute()
	var btn = $CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/AudioBtn as Button
	if btn:
		btn.text = "Sound: OFF" if muted else "Sound: ON"

func _on_guide_toggle_pressed() -> void:
	var visible_guides = writing_canvas.toggle_guides()
	var btn = $CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/GuideBtn as Button
	if btn:
		btn.text = "Guides: ON" if visible_guides else "Guides: OFF"

# -------------------------------------------------------------
# Procedural Vector Particle Textures (No Broken Squares)
# -------------------------------------------------------------
func _generate_star_texture(size: int = 36) -> ImageTexture:
	var img = Image.create(size, size, false, Image.FORMAT_RGBA8)
	var center = Vector2(size * 0.5, size * 0.5)
	var r_outer = size * 0.46
	var r_inner = size * 0.20
	for y in range(size):
		for x in range(size):
			var pt = Vector2(x + 0.5, y + 0.5)
			var diff = pt - center
			var dist = diff.length()
			if dist > r_outer + 1.0:
				continue
			var angle = atan2(diff.y, diff.x)
			var a_norm = fmod(angle + PI * 0.5 + TAU * 2.0, TAU)
			var arm = fmod(a_norm, TAU / 5.0) / (TAU / 5.0)
			var factor = absf(arm - 0.5) * 2.0
			var r_star = lerp(r_inner, r_outer, factor)
			if dist <= r_star:
				var alpha = clampf((r_star - dist) * 2.0, 0.0, 1.0)
				img.set_pixel(x, y, Color(1.0, 1.0, 1.0, alpha))
	return ImageTexture.create_from_image(img)

func _generate_ribbon_texture(width: int = 30, height: int = 14) -> ImageTexture:
	var img = Image.create(width, height, false, Image.FORMAT_RGBA8)
	var radius = height * 0.40
	for y in range(height):
		for x in range(width):
			var cx = clampf(x + 0.5, radius, width - radius)
			var cy = clampf(y + 0.5, radius, height - radius)
			var dist = Vector2(x + 0.5 - cx, y + 0.5 - cy).length()
			if dist <= radius:
				var alpha = clampf((radius - dist) * 2.0, 0.0, 1.0)
				img.set_pixel(x, y, Color(1.0, 1.0, 1.0, alpha))
	return ImageTexture.create_from_image(img)

func _generate_sparkle_texture(size: int = 32) -> ImageTexture:
	var img = Image.create(size, size, false, Image.FORMAT_RGBA8)
	var center = Vector2(size * 0.5, size * 0.5)
	var half = size * 0.46
	for y in range(size):
		for x in range(size):
			var nx = absf((x + 0.5 - center.x) / half)
			var ny = absf((y + 0.5 - center.y) / half)
			var val = sqrt(nx) + sqrt(ny)
			if val <= 1.0:
				var alpha = clampf((1.0 - val) * 2.5, 0.0, 1.0)
				img.set_pixel(x, y, Color(1.0, 1.0, 1.0, alpha))
	return ImageTexture.create_from_image(img)

# -------------------------------------------------------------
# Procedural Vector 5-Pointed Star UI Drawing
# -------------------------------------------------------------
func _on_star_icon_draw() -> void:
	if not star_icon:
		return
	var radius = minf(star_icon.size.x, star_icon.size.y) * 0.44
	var center = star_icon.size * 0.5
	_draw_5pt_star(star_icon, center, radius, Color(1.0, 0.85, 0.15), Color(1.0, 0.96, 0.55))

func _on_star_rating_box_draw() -> void:
	if not star_rating_box:
		return
	var star_w = 44.0
	var spacing = 18.0
	var total_w = 3.0 * star_w + 2.0 * spacing
	var start_x = (star_rating_box.size.x - total_w) * 0.5 + star_w * 0.5
	var cy = star_rating_box.size.y * 0.5
	for i in range(3):
		var cx = start_x + float(i) * (star_w + spacing)
		var is_filled = (i < current_modal_stars)
		var fill_col = Color(1.0, 0.85, 0.15) if is_filled else Color(0.25, 0.30, 0.38, 0.6)
		var line_col = Color(1.0, 0.95, 0.50) if is_filled else Color(0.40, 0.45, 0.55, 0.6)
		_draw_5pt_star(star_rating_box, Vector2(cx, cy), star_w * 0.5, fill_col, line_col)

static func _draw_5pt_star(ci: CanvasItem, center: Vector2, radius: float, fill_col: Color, line_col: Color) -> void:
	var pts = PackedVector2Array()
	for k in range(10):
		var r = radius if (k % 2 == 0) else (radius * 0.42)
		var angle = (float(k) * PI / 5.0) - (PI * 0.5)
		pts.append(center + Vector2(cos(angle), sin(angle)) * r)
	ci.draw_colored_polygon(pts, fill_col)
	pts.append(pts[0])
	ci.draw_polyline(pts, line_col, 2.2, true)
`,
);

// -------------------------------------------------------------------------
// 4. GODOT 4 MAIN SCENE (.tscn)
// -------------------------------------------------------------------------

writeFile(
  "scenes/main_game.tscn",
  `[gd_scene format=3 uid="uid://c8yjq01fkl23m"]

[ext_resource type="Script" path="res://scripts/main_game.gd" id="1_main"]
[ext_resource type="Script" path="res://scripts/sound_manager.gd" id="2_sound"]
[ext_resource type="PackedScene" path="res://assets/models/mouse_robot.scad" id="3_robot"]
[ext_resource type="Script" path="res://scripts/teacher_robot.gd" id="4_teacher"]
[ext_resource type="PackedScene" path="res://assets/models/toy_blocks.scad" id="5_blocks"]
[ext_resource type="Script" path="res://scripts/writing_canvas.gd" id="6_canvas"]

[sub_resource type="ProceduralSkyMaterial" id="ProceduralSkyMaterial_sky"]
sky_top_color = Color(0.28, 0.50, 0.75, 1)
sky_horizon_color = Color(0.60, 0.70, 0.80, 1)
ground_bottom_color = Color(0.18, 0.16, 0.14, 1)
ground_horizon_color = Color(0.55, 0.60, 0.65, 1)

[sub_resource type="Sky" id="Sky_env"]
sky_material = SubResource("ProceduralSkyMaterial_sky")

[sub_resource type="Environment" id="Environment_main"]
background_mode = 2
sky = SubResource("Sky_env")
ambient_light_source = 2
ambient_light_color = Color(0.55, 0.60, 0.65, 1)
tonemap_mode = 3
tonemap_exposure = 0.6
glow_enabled = true
glow_bloom = 0.1

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_floor"]
albedo_color = Color(0.65, 0.52, 0.38, 1)
roughness = 0.70

[sub_resource type="PlaneMesh" id="PlaneMesh_floor"]
material = SubResource("StandardMaterial3D_floor")
size = Vector2(14, 14)

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_wall"]
albedo_color = Color(0.48, 0.56, 0.64, 1)
roughness = 0.85

[sub_resource type="BoxMesh" id="BoxMesh_wall"]
material = SubResource("StandardMaterial3D_wall")
size = Vector3(14, 5, 0.2)

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_header"]
bg_color = Color(0.12, 0.16, 0.22, 0.95)
border_width_bottom = 2
border_color = Color(0.25, 0.35, 0.48, 0.8)

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_starbox"]
bg_color = Color(0.18, 0.22, 0.30, 0.9)
corner_radius_top_left = 14
corner_radius_top_right = 14
corner_radius_bottom_right = 14
corner_radius_bottom_left = 14
border_width_left = 1
border_width_top = 1
border_width_right = 1
border_width_bottom = 1
border_color = Color(1, 0.85, 0.25, 0.6)

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_board"]
bg_color = Color(0.10, 0.14, 0.18, 1)
corner_radius_top_left = 14
corner_radius_top_right = 14
corner_radius_bottom_right = 14
corner_radius_bottom_left = 14
border_width_left = 3
border_width_top = 3
border_width_right = 3
border_width_bottom = 3
border_color = Color(0.22, 0.28, 0.38, 0.9)
shadow_size = 10
shadow_color = Color(0, 0, 0, 0.4)

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_tools"]
bg_color = Color(0.12, 0.16, 0.22, 0.95)
corner_radius_top_left = 14
corner_radius_top_right = 14
corner_radius_bottom_right = 14
corner_radius_bottom_left = 14
border_width_left = 1
border_width_top = 1
border_width_right = 1
border_width_bottom = 1
border_color = Color(0.25, 0.34, 0.46, 0.8)
shadow_size = 6
shadow_color = Color(0, 0, 0, 0.3)

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_speech"]
bg_color = Color(0.10, 0.14, 0.20, 0.92)
corner_radius_top_left = 16
corner_radius_top_right = 16
corner_radius_bottom_right = 16
corner_radius_bottom_left = 16
border_width_left = 2
border_width_top = 2
border_width_right = 2
border_width_bottom = 2
border_color = Color(0.20, 0.75, 0.95, 0.60)
shadow_size = 8
shadow_color = Color(0, 0, 0, 0.35)

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_bottom"]
bg_color = Color(0.10, 0.13, 0.18, 0.95)
border_width_top = 2
border_color = Color(0.22, 0.28, 0.38, 0.8)

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_modal"]
bg_color = Color(0.12, 0.16, 0.22, 0.98)
corner_radius_top_left = 20
corner_radius_top_right = 20
corner_radius_bottom_right = 20
corner_radius_bottom_left = 20
border_width_left = 3
border_width_top = 3
border_width_right = 3
border_width_bottom = 3
border_color = Color(1.0, 0.82, 0.20, 0.95)
shadow_size = 16
shadow_color = Color(0, 0, 0, 0.5)

[sub_resource type="Curve" id="Curve_pop"]
_data = [Vector2(0, 0), 0.0, 0.0, 0, 0, Vector2(0.12, 1), 0.0, 0.0, 0, 0, Vector2(0.75, 1), 0.0, 0.0, 0, 0, Vector2(1, 0), 0.0, 0.0, 0, 0]
point_count = 4

[sub_resource type="Gradient" id="Gradient_fade"]
offsets = PackedFloat32Array(0, 0.15, 0.7, 1)
colors = PackedColorArray(1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0)

[node name="MainGame" type="Node3D"]
script = ExtResource("1_main")

[node name="SoundManager" type="Node" parent="."]
script = ExtResource("2_sound")

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_main")

[node name="KeyLight" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.866, -0.287, 0.409, 0, 0.819, 0.574, -0.5, -0.497, 0.709, 1.2, 4, 3)
light_color = Color(1, 0.98, 0.92, 1)
light_energy = 0.5
shadow_enabled = true
shadow_opacity = 0.7
directional_shadow_max_distance = 6.0
directional_shadow_bias = 0.02
directional_shadow_normal_bias = 1.0

[node name="FillLight" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.707, 0, -0.707, -0.353, 0.866, -0.353, 0.612, 0.5, 0.612, -2, 3, 2)
light_color = Color(0.6, 0.8, 1, 1)
light_energy = 0.5
sky_mode = 1

[node name="RimLight" type="DirectionalLight3D" parent="."]
transform = Transform3D(-0.866, 0, -0.5, 0, 1, 0, 0.5, 0, -0.866, -1, 2, -3)
light_color = Color(1, 0.7, 0.9, 1)
light_energy = 0.4
sky_mode = 1

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.985, 0.174, 0, -0.174, 0.985, 0.2, 1.22, 2.3)
current = true
fov = 55.0

[node name="World3D" type="Node3D" parent="."]

[node name="ClassroomFloor" type="MeshInstance3D" parent="World3D"]
mesh = SubResource("PlaneMesh_floor")

[node name="ClassroomWall" type="MeshInstance3D" parent="World3D"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2.5, -2.4)
mesh = SubResource("BoxMesh_wall")

[node name="MouseRobot" parent="World3D" instance=ExtResource("3_robot")]
transform = Transform3D(-0.0508, 0, -0.0356, 0, 0.062, 0, 0.0356, 0, -0.0508, -0.85, 0.08, -0.2)
script = ExtResource("4_teacher")

[node name="ToyBlocks" parent="World3D" instance=ExtResource("5_blocks")]
transform = Transform3D(-1, 0, 0, 0, 1, 0, 0, 0, -1, -1.15, 0, 0.15)

[node name="CanvasLayer" type="CanvasLayer" parent="."]

[node name="UI" type="Control" parent="CanvasLayer"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2

[node name="HeaderBar" type="PanelContainer" parent="CanvasLayer/UI"]
layout_mode = 1
anchors_preset = 10
anchor_right = 1.0
offset_bottom = 68.0
grow_horizontal = 2
theme_override_styles/panel = SubResource("StyleBoxFlat_header")

[node name="HeaderMargin" type="MarginContainer" parent="CanvasLayer/UI/HeaderBar"]
layout_mode = 2
theme_override_constants/margin_left = 20
theme_override_constants/margin_top = 8
theme_override_constants/margin_right = 20
theme_override_constants/margin_bottom = 8

[node name="HBox" type="HBoxContainer" parent="CanvasLayer/UI/HeaderBar/HeaderMargin"]
layout_mode = 2
theme_override_constants/separation = 16

[node name="AppTitle" type="Label" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox"]
layout_mode = 2
theme_override_colors/font_color = Color(1, 0.85, 0.25, 1)
theme_override_font_sizes/font_size = 22
text = "Professor Pip's Digit Lab"

[node name="DigitTitle" type="Label" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox"]
layout_mode = 2
size_flags_horizontal = 3
theme_override_colors/font_color = Color(0.3, 0.9, 1, 1)
theme_override_font_sizes/font_size = 22
text = "Trace Number 0!"
horizontal_alignment = 1

[node name="StarDisplay" type="PanelContainer" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox"]
layout_mode = 2
theme_override_styles/panel = SubResource("StyleBoxFlat_starbox")

[node name="StarMargin" type="MarginContainer" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/StarDisplay"]
layout_mode = 2
theme_override_constants/margin_left = 10
theme_override_constants/margin_top = 4
theme_override_constants/margin_right = 12
theme_override_constants/margin_bottom = 4

[node name="HBox" type="HBoxContainer" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/StarDisplay/StarMargin"]
layout_mode = 2
theme_override_constants/separation = 6

[node name="StarIcon" type="Control" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/StarDisplay/StarMargin/HBox"]
custom_minimum_size = Vector2(24, 24)
layout_mode = 2

[node name="StarLabel" type="Label" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/StarDisplay/StarMargin/HBox"]
layout_mode = 2
theme_override_colors/font_color = Color(1, 0.88, 0.2, 1)
theme_override_font_sizes/font_size = 18
text = "0 / 30"

[node name="DemoBtn" type="Button" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox"]
layout_mode = 2
theme_override_font_sizes/font_size = 16
text = "Watch Pip"

[node name="GuideBtn" type="Button" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox"]
layout_mode = 2
theme_override_font_sizes/font_size = 16
text = "Guides: ON"

[node name="AudioBtn" type="Button" parent="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox"]
layout_mode = 2
theme_override_font_sizes/font_size = 16
text = "Sound: ON"

[node name="MainHBox" type="HBoxContainer" parent="CanvasLayer/UI"]
layout_mode = 1
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
offset_top = 74.0
offset_bottom = -96.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2

[node name="LeftSpacer" type="Control" parent="CanvasLayer/UI/MainHBox"]
layout_mode = 2
size_flags_horizontal = 3
mouse_filter = 2

[node name="BoardContainer" type="VBoxContainer" parent="CanvasLayer/UI/MainHBox"]
layout_mode = 2
size_flags_horizontal = 3
theme_override_constants/separation = 10

[node name="BoardPanel" type="PanelContainer" parent="CanvasLayer/UI/MainHBox/BoardContainer"]
layout_mode = 2
size_flags_vertical = 3
theme_override_styles/panel = SubResource("StyleBoxFlat_board")

[node name="WritingCanvas" type="Control" parent="CanvasLayer/UI/MainHBox/BoardContainer/BoardPanel"]
layout_mode = 2
size_flags_horizontal = 3
size_flags_vertical = 3
script = ExtResource("6_canvas")

[node name="ToolsContainer" type="PanelContainer" parent="CanvasLayer/UI/MainHBox/BoardContainer"]
layout_mode = 2
theme_override_styles/panel = SubResource("StyleBoxFlat_tools")

[node name="ToolsMargin" type="MarginContainer" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer"]
layout_mode = 2
theme_override_constants/margin_left = 14
theme_override_constants/margin_top = 6
theme_override_constants/margin_right = 14
theme_override_constants/margin_bottom = 6

[node name="ToolsBar" type="HBoxContainer" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin"]
layout_mode = 2
theme_override_constants/separation = 12
alignment = 1

[node name="ClearBtn" type="Button" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
custom_minimum_size = Vector2(85, 38)
layout_mode = 2
theme_override_font_sizes/font_size = 16
text = "Clear"

[node name="UndoBtn" type="Button" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
custom_minimum_size = Vector2(85, 38)
layout_mode = 2
theme_override_font_sizes/font_size = 16
text = "Undo"

[node name="ColorLabel" type="Label" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
layout_mode = 2
theme_override_colors/font_color = Color(0.85, 0.90, 0.96, 1)
theme_override_font_sizes/font_size = 16
text = "Chalk:"

[node name="ColorCyan" type="Button" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
custom_minimum_size = Vector2(36, 36)
layout_mode = 2
focus_mode = 0

[node name="ColorYellow" type="Button" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
custom_minimum_size = Vector2(36, 36)
layout_mode = 2
focus_mode = 0

[node name="ColorPink" type="Button" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
custom_minimum_size = Vector2(36, 36)
layout_mode = 2
focus_mode = 0

[node name="ColorGreen" type="Button" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
custom_minimum_size = Vector2(36, 36)
layout_mode = 2
focus_mode = 0

[node name="ColorWhite" type="Button" parent="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar"]
custom_minimum_size = Vector2(36, 36)
layout_mode = 2
focus_mode = 0

[node name="RightSpacer" type="Control" parent="CanvasLayer/UI/MainHBox"]
layout_mode = 2
size_flags_horizontal = 3
size_flags_stretch_ratio = 0.1
mouse_filter = 2

[node name="SpeechBalloon" type="PanelContainer" parent="CanvasLayer/UI"]
layout_mode = 1
anchors_preset = 2
anchor_top = 1.0
anchor_bottom = 1.0
offset_left = 24.0
offset_top = -280.0
offset_right = 380.0
offset_bottom = -110.0
grow_vertical = 0
theme_override_styles/panel = SubResource("StyleBoxFlat_speech")

[node name="BalloonMargin" type="MarginContainer" parent="CanvasLayer/UI/SpeechBalloon"]
layout_mode = 2
theme_override_constants/margin_left = 16
theme_override_constants/margin_top = 12
theme_override_constants/margin_right = 16
theme_override_constants/margin_bottom = 12

[node name="VBox" type="VBoxContainer" parent="CanvasLayer/UI/SpeechBalloon/BalloonMargin"]
layout_mode = 2
theme_override_constants/separation = 4

[node name="SpeakerLabel" type="Label" parent="CanvasLayer/UI/SpeechBalloon/BalloonMargin/VBox"]
layout_mode = 2
theme_override_colors/font_color = Color(1, 0.85, 0.25, 1)
theme_override_font_sizes/font_size = 15
text = "Professor Pip says:"

[node name="SpeechText" type="Label" parent="CanvasLayer/UI/SpeechBalloon/BalloonMargin/VBox"]
layout_mode = 2
theme_override_colors/font_color = Color(0.95, 0.98, 1, 1)
theme_override_font_sizes/font_size = 17
text = "Around and around and around we go,\\nwhen we get home we have a zero!"
autowrap_mode = 3

[node name="BottomBar" type="PanelContainer" parent="CanvasLayer/UI"]
layout_mode = 1
anchors_preset = 12
anchor_top = 1.0
anchor_right = 1.0
anchor_bottom = 1.0
offset_top = -88.0
grow_horizontal = 2
grow_vertical = 0
theme_override_styles/panel = SubResource("StyleBoxFlat_bottom")

[node name="DigitScroll" type="ScrollContainer" parent="CanvasLayer/UI/BottomBar"]
layout_mode = 2
vertical_scroll_mode = 0

[node name="DigitHBox" type="HBoxContainer" parent="CanvasLayer/UI/BottomBar/DigitScroll"]
layout_mode = 2
size_flags_horizontal = 3
size_flags_vertical = 3
theme_override_constants/separation = 14
alignment = 1

[node name="CelebrationModal" type="Control" parent="CanvasLayer"]
visible = false
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2

[node name="Backdrop" type="ColorRect" parent="CanvasLayer/CelebrationModal"]
layout_mode = 1
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
color = Color(0.05, 0.08, 0.12, 0.70)

[node name="ModalPanel" type="PanelContainer" parent="CanvasLayer/CelebrationModal"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -250.0
offset_top = -170.0
offset_right = 250.0
offset_bottom = 170.0
grow_horizontal = 2
grow_vertical = 2
theme_override_styles/panel = SubResource("StyleBoxFlat_modal")

[node name="VBox" type="VBoxContainer" parent="CanvasLayer/CelebrationModal/ModalPanel"]
layout_mode = 2
theme_override_constants/separation = 14
alignment = 1

[node name="CongratsTitle" type="Label" parent="CanvasLayer/CelebrationModal/ModalPanel/VBox"]
layout_mode = 2
theme_override_colors/font_color = Color(1, 0.85, 0.2, 1)
theme_override_font_sizes/font_size = 30
text = "SUPER WRITER!"
horizontal_alignment = 1

[node name="StarRatingBox" type="Control" parent="CanvasLayer/CelebrationModal/ModalPanel/VBox"]
custom_minimum_size = Vector2(220, 52)
layout_mode = 2

[node name="RhymeText" type="Label" parent="CanvasLayer/CelebrationModal/ModalPanel/VBox"]
layout_mode = 2
theme_override_font_sizes/font_size = 19
text = "Great job writing your digit!"
horizontal_alignment = 1
autowrap_mode = 3

[node name="BtnHBox" type="HBoxContainer" parent="CanvasLayer/CelebrationModal/ModalPanel/VBox"]
layout_mode = 2
theme_override_constants/separation = 20
alignment = 1

[node name="ReplayBtn" type="Button" parent="CanvasLayer/CelebrationModal/ModalPanel/VBox/BtnHBox"]
custom_minimum_size = Vector2(130, 46)
layout_mode = 2
theme_override_font_sizes/font_size = 17
text = "Try Again"

[node name="NextBtn" type="Button" parent="CanvasLayer/CelebrationModal/ModalPanel/VBox/BtnHBox"]
custom_minimum_size = Vector2(160, 46)
layout_mode = 2
theme_override_colors/font_color = Color(0.2, 1, 0.4, 1)
theme_override_font_sizes/font_size = 18
text = "Next Number >"

[node name="ConfettiStars" type="CPUParticles2D" parent="CanvasLayer"]
position = Vector2(640, 360)
emitting = false
amount = 45
lifetime = 1.8
one_shot = true
explosiveness = 0.82
emission_shape = 1
emission_sphere_radius = 60.0
direction = Vector2(0, -1)
spread = 180.0
gravity = Vector2(0, 340)
initial_velocity_min = 220.0
initial_velocity_max = 480.0
angle_min = 0.0
angle_max = 360.0
angular_velocity_min = -240.0
angular_velocity_max = 240.0
scale_amount_min = 0.7
scale_amount_max = 1.3
scale_amount_curve = SubResource("Curve_pop")
color = Color(1, 0.88, 0.2, 1)
color_ramp = SubResource("Gradient_fade")
hue_variation_min = -1.0
hue_variation_max = 1.0

[node name="ConfettiRibbons" type="CPUParticles2D" parent="CanvasLayer"]
position = Vector2(640, 360)
emitting = false
amount = 55
lifetime = 2.2
one_shot = true
explosiveness = 0.85
emission_shape = 1
emission_sphere_radius = 80.0
direction = Vector2(0, -1)
spread = 180.0
gravity = Vector2(0, 260)
initial_velocity_min = 180.0
initial_velocity_max = 420.0
angle_min = 0.0
angle_max = 360.0
angular_velocity_min = -360.0
angular_velocity_max = 360.0
scale_amount_min = 0.8
scale_amount_max = 1.4
scale_amount_curve = SubResource("Curve_pop")
color = Color(0.2, 0.85, 1, 1)
color_ramp = SubResource("Gradient_fade")
hue_variation_min = -1.0
hue_variation_max = 1.0

[node name="CheckpointSparkles" type="CPUParticles2D" parent="CanvasLayer"]
position = Vector2(0, 0)
emitting = false
amount = 14
lifetime = 0.55
one_shot = true
explosiveness = 0.92
emission_shape = 0
spread = 180.0
gravity = Vector2(0, 100)
initial_velocity_min = 80.0
initial_velocity_max = 180.0
angle_min = 0.0
angle_max = 360.0
angular_velocity_min = -180.0
angular_velocity_max = 180.0
scale_amount_min = 0.5
scale_amount_max = 1.0
scale_amount_curve = SubResource("Curve_pop")
color = Color(1, 0.90, 0.35, 1)
color_ramp = SubResource("Gradient_fade")

[connection signal="pressed" from="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/DemoBtn" to="." method="_on_demo_btn_pressed"]
[connection signal="pressed" from="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/GuideBtn" to="." method="_on_guide_toggle_pressed"]
[connection signal="pressed" from="CanvasLayer/UI/HeaderBar/HeaderMargin/HBox/AudioBtn" to="." method="_on_audio_toggle_pressed"]
[connection signal="pressed" from="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar/ClearBtn" to="." method="_on_clear_btn_pressed"]
[connection signal="pressed" from="CanvasLayer/UI/MainHBox/BoardContainer/ToolsContainer/ToolsMargin/ToolsBar/UndoBtn" to="." method="_on_undo_btn_pressed"]
[connection signal="pressed" from="CanvasLayer/CelebrationModal/ModalPanel/VBox/BtnHBox/ReplayBtn" to="." method="_on_replay_pressed"]
[connection signal="pressed" from="CanvasLayer/CelebrationModal/ModalPanel/VBox/BtnHBox/NextBtn" to="." method="_on_next_pressed"]
`,
);

// -------------------------------------------------------------------------
// 5. PROJECT SETTINGS, GITIGNORE & README
// -------------------------------------------------------------------------

writeFile(
  "project.godot",
  `; Engine configuration file.
; It's best edited using the editor UI and not directly,
; but it can be edited here for direct configuration.

config_version=5

[application]

config/name="Robot Digit Writing Lab"
config/description="Interactive 3D Kids Digit Writing App with Teacher Mouse Robot"
run/main_scene="res://scenes/main_game.tscn"
config/features=PackedStringArray("4.3", "GL Compatibility")

[display]

window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"
window/handheld/orientation=6

[editor_plugins]

enabled=PackedStringArray("res://addons/scad_importer/plugin.cfg")

[rendering]

renderer/rendering_method="gl_compatibility"
renderer/rendering_method.web="gl_compatibility"
anti_aliasing/quality/msaa_3d=2
`,
);

writeFile(
  ".gitignore",
  `
.godot/
*.tmp
*.log
`,
);

writeFile(
  "README.md",
  `# Robot Digit Writing Lab

An educational, interactive 3D digit writing learning app for kids created with Godot 4 and procedural OpenSCAD 3D assets.

## Features

- **3D Teacher Mouse Robot ("Professor Pip")**:
  - Procedural hierarchical bone armature animation.
  - Idle breathing loop and joyful jumping "Praise" animation when kids complete digits!
  - Fully calibrated anti-glare toy materials and soft directional contact shadows.
  - Reacts dynamically: turns towards the board while tracing, faces the child during celebrations!

- **Festive Vector Particle System**:
  - Procedural anti-aliased Star, Ribbon, and Sparkle textures (no placeholder square quads!).
  - Rotating, tumbling multi-colored rainbow confetti bursts upon digit completion.
  - Checkpoint sparkle bursts popping directly under the child's touch with each tracing milestone.

- **Preschool Digit Tracing Curriculum (0 through 9)**:
  - Guided stroke paths with numbered directional arrows and checkpoint beads.
  - Traditional preschool digit rhymes for all digits 0-9.
  - Multi-stroke support for complex digits like 4, 5, and 7.
  - "Watch Pip" Demo Mode: Professor Pip animates a magic stylus along the strokes.
`,
);

console.log('\nProject "kids_digit_writing" successfully updated!');
console.log("You can now run:");
console.log("  node kids_digit_writing.js");
console.log(
  "  ~/Documents/projects/external/godot/bin/godot.linuxbsd.editor.x86_64 -e",
);
