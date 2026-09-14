// Self-contained generator for Battleship 3D with the original flame spire style elevated higher,
// corrected HUD reticle corners, and full English localization.
const fs = require("fs");
const path = require("path");

const ROOT_DIR = "naval_battle_3d";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(relativePath, content) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content.trimStart(), "utf8");
  console.log(`Created: ${relativePath}`);
}

console.log(`\n=== Generating Battleship 3D: ${ROOT_DIR} ===\n`);
ensureDir(ROOT_DIR);

// =========================================================================
// 1. ADDON: SCAD IMPORTER
// =========================================================================

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
	regex.compile("(?:include|use)\\\\s*[<\\\"]([^>\\\"]+)[>\\\"]")

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

// =========================================================================
// 2. OPENSCAD PROCEDURAL 3D ASSETS (.scad)
// =========================================================================

// marker_hit.scad - Original glowing crystal flame spire style, elevated higher (~2.8m)
writeFile(
  "assets/models/marker_hit.scad",
  `// Hit Marker: Flaming Crimson Naval Beacon (Elevated Flame Spires)
$fn = 20;

module hit_marker() {
    // Buoy Base ring
    color([0.15, 0.15, 0.18], metalness=0.8, roughness=0.4, $asa=30) {
        cylinder(h=0.2, r=0.6, center=true);
    }
    // Warning red float
    color([0.9, 0.1, 0.1], metalness=0.3, roughness=0.3, $asa=30) {
        translate([0, 0, 0.28])
            cylinder(h=0.36, r1=0.55, r2=0.4, center=true);
    }
    // Burning core / high energy plasma flame spire (elongated upwards)
    color([1.0, 0.2, 0.05], metalness=0.1, roughness=0.1, emissive=[1.0, 0.25, 0.0], emissiveIntensity=3.2, $asa=45) {
        // Main central flame column (rises up to Z=2.8m)
        translate([0, 0, 1.45])
            cylinder(h=2.1, r1=0.26, r2=0.02, center=true);

        // Lower tier flame crystals
        for (a = [0, 60, 120, 180, 240, 300]) {
            rotate([0, 0, a]) translate([0.2, 0, 1.0])
                cylinder(h=1.2, r1=0.08, r2=0.01, center=true);
        }

        // Upper tier flame crystals
        for (a = [30, 90, 150, 210, 270, 330]) {
            rotate([0, 0, a]) translate([0.12, 0, 1.75])
                cylinder(h=1.1, r1=0.06, r2=0.01, center=true);
        }
    }
    // Pulsing inner diamond core
    color([1.0, 0.9, 0.2], metalness=0.1, roughness=0.1, emissive=[1.0, 0.9, 0.2], emissiveIntensity=4.5) {
        translate([0, 0, 0.65])
            sphere(r=0.25);
    }
}

hit_marker();
`,
);

// targeting_reticle.scad - Corrected HUD framing corners pointing inward
writeFile(
  "assets/models/targeting_reticle.scad",
  `// Holographic 3D Targeting Reticle
// Fits standard 2.0m grid tile (size 1.8x1.8m)
$fn = 16;

module corner_bracket() {
    // Top-right corner apex is at (+0.9, +0.9)
    // Horizontal arm goes inward along -X to 0.5
    translate([0.7, 0.9, 0.08])
        cube([0.4, 0.09, 0.12], center=true);
    // Vertical arm goes inward along -Y to 0.5
    translate([0.9, 0.7, 0.08])
        cube([0.09, 0.4, 0.12], center=true);
    // Vertical corner indicator post
    translate([0.9, 0.9, 0.2])
        cube([0.09, 0.09, 0.35], center=true);
}

module reticle() {
    color([0.1, 0.95, 1.0], metalness=0.2, roughness=0.2, emissive=[0.15, 0.95, 1.0], emissiveIntensity=3.2) {
        // 4 inward-framing brackets: 0=TR, 90=TL, 180=BL, 270=BR
        for (rot = [0, 90, 180, 270]) {
            rotate([0, 0, rot])
                corner_bracket();
        }
        // Center crosshair ring and dot
        cylinder(h=0.08, r=0.12, center=true);
        difference() {
            cylinder(h=0.06, r=0.36, center=true);
            cylinder(h=0.09, r=0.30, center=true);
        }
    }
}

reticle();
`,
);

// marker_miss.scad - Water splash buoy
writeFile(
  "assets/models/marker_miss.scad",
  `// Miss Marker: White Water Splash & Marine Buoy
$fn = 20;

module miss_marker() {
    color([0.2, 0.7, 0.9], metalness=0.1, roughness=0.2, emissive=[0.1, 0.4, 0.6], emissiveIntensity=1.0, $asa=30) {
        difference() {
            cylinder(h=0.1, r=0.75, center=true);
            cylinder(h=0.15, r=0.5, center=true);
        }
    }
    color([0.9, 0.92, 0.95], metalness=0.2, roughness=0.5, $asa=30) {
        translate([0, 0, 0.3])
            cylinder(h=0.4, r1=0.4, r2=0.3, center=true);
    }
    color([0.1, 0.6, 1.0], metalness=0.1, roughness=0.1, emissive=[0.2, 0.7, 1.0], emissiveIntensity=2.0, $asa=30) {
        translate([0, 0, 0.55])
            sphere(r=0.25);
    }
    color([0.95, 0.95, 0.95], metalness=0.8, roughness=0.3) {
        translate([0, 0, 0.9])
            cylinder(h=0.6, r=0.02, center=true);
    }
}

miss_marker();
`,
);

// ocean_grid_table.scad - 10x10 Tactical Ocean Board
writeFile(
  "assets/models/ocean_grid_table.scad",
  `// 10x10 Tactical Ocean Grid Table
$fn = 24;

module wooden_border() {
    color([0.14, 0.09, 0.05], metalness=0.1, roughness=0.7, $asa=30) {
        difference() {
            translate([0, 0, -0.4])
                cube([22.0, 22.0, 0.8], center=true);
            translate([0, 0, 0.1])
                cube([20.0, 20.0, 1.0], center=true);
        }
    }
    color([0.85, 0.65, 0.18], metalness=0.9, roughness=0.25, $asa=45) {
        for (mx = [-10.5, 10.5]) {
            for (my = [-10.5, 10.5]) {
                translate([mx, my, 0.05])
                    cube([1.5, 1.5, 0.22], center=true);
            }
        }
    }
}

module water_surface() {
    color([0.04, 0.16, 0.32], metalness=0.2, roughness=0.15, emissive=[0.01, 0.04, 0.08], emissiveIntensity=1.0, $asa=30) {
        translate([0, 0, -0.1])
            cube([20.0, 20.0, 0.3], center=true);
    }
}

module grid_lines() {
    color([0.2, 0.65, 0.9], metalness=0.3, roughness=0.3, emissive=[0.12, 0.55, 0.85], emissiveIntensity=1.8) {
        for (i = [-5 : 5]) {
            translate([i * 2.0, 0, 0.06])
                cube([0.05, 20.0, 0.04], center=true);
            translate([0, i * 2.0, 0.06])
                cube([20.0, 0.05, 0.04], center=true);
        }
    }
}

union() {
    wooden_border();
    water_surface();
    grid_lines();
}
`,
);

// ship_carrier.scad - 5 cells (~9.2m long)
writeFile(
  "assets/models/ship_carrier.scad",
  `// Aircraft Carrier (Size: 5 Cells = ~9.2m)
$fn = 20;

anim = [
    ["RadarSpin", [
        ["RadarTower", [
            [0.0, [0, 0, 0]],
            [1.0, [0, 0, 90]],
            [2.0, [0, 0, 180]],
            [3.0, [0, 0, 270]],
            [4.0, [0, 0, 360]]
        ]]
    ]]
];

module carrier_hull() {
    color([0.22, 0.25, 0.28], metalness=0.8, roughness=0.45, $asa=35) {
        hull() {
            translate([0, -4.4, 0.4]) cube([1.6, 0.4, 0.7], center=true);
            translate([0, 0.0, 0.4]) cube([1.7, 5.0, 0.7], center=true);
            translate([0, 4.3, 0.4]) cube([0.4, 0.2, 0.7], center=true);
        }
    }
    color([0.15, 0.16, 0.18], metalness=0.3, roughness=0.7, $asa=20) {
        translate([-0.1, 0, 0.85])
            cube([1.9, 9.2, 0.2], center=true);
    }
    color([0.9, 0.75, 0.1], metalness=0.1, roughness=0.5, emissive=[0.4, 0.3, 0.0], emissiveIntensity=1.0) {
        translate([-0.2, 0, 0.96])
            cube([0.1, 8.4, 0.03], center=true);
        for (y = [-3.0 : 1.5 : 3.0]) {
            translate([-0.2, y, 0.96])
                cube([0.8, 0.15, 0.03], center=true);
        }
    }
    color([0.3, 0.33, 0.36], metalness=0.7, roughness=0.4, $asa=30) {
        translate([0.65, 0.4, 1.25])
            cube([0.45, 1.8, 0.7], center=true);
        translate([0.65, 0.8, 1.7])
            cube([0.35, 0.8, 0.4], center=true);
        color([0.2, 0.8, 0.9], metalness=0.9, roughness=0.1, emissive=[0.2, 0.8, 0.9], emissiveIntensity=1.2) {
            translate([0.65, 1.15, 1.7])
                cube([0.3, 0.12, 0.15], center=true);
        }
    }
}

armature(animations=anim) {
    carrier_hull();
    bone(name="RadarTower", t=[0.65, 0.4, 1.95], r=[0, 0, 0]) {
        color([0.85, 0.85, 0.1], metalness=0.8, roughness=0.3) {
            cylinder(h=0.4, r=0.04, center=true);
            translate([0, 0, 0.2])
                cube([0.6, 0.08, 0.15], center=true);
        }
    }
}
`,
);

// ship_battleship.scad - 4 cells (~7.2m long)
writeFile(
  "assets/models/ship_battleship.scad",
  `// Battleship (Size: 4 Cells = ~7.2m)
$fn = 20;

anim = [
    ["IdleTurret", [
        ["ForwardTurret", [
            [0.0, [0, 0, 0]],
            [1.5, [0, 0, 15]],
            [3.0, [0, 0, 0]],
            [4.5, [0, 0, -15]],
            [6.0, [0, 0, 0]]
        ]]
    ]]
];

module main_hull() {
    color([0.25, 0.28, 0.32], metalness=0.85, roughness=0.35, $asa=35) {
        hull() {
            translate([0, -3.4, 0.4]) cube([1.4, 0.4, 0.75], center=true);
            translate([0, 0.0, 0.4]) cube([1.55, 3.5, 0.8], center=true);
            translate([0, 3.4, 0.4]) cube([0.3, 0.2, 0.75], center=true);
        }
    }
    color([0.2, 0.22, 0.25], metalness=0.6, roughness=0.5, $asa=30) {
        translate([0, 0.0, 0.85])
            cube([1.1, 3.2, 0.2], center=true);
        translate([0, 0.3, 1.25])
            cube([0.7, 1.4, 0.6], center=true);
        translate([0, -0.7, 1.3])
            cylinder(h=0.7, r1=0.22, r2=0.18, center=true);
        translate([0, -1.2, 1.25])
            cylinder(h=0.6, r1=0.2, r2=0.16, center=true);
    }
    color([0.1, 0.8, 0.7], metalness=0.5, roughness=0.2, emissive=[0.1, 0.8, 0.7], emissiveIntensity=1.5) {
        translate([0, 0.95, 1.35])
            cube([0.6, 0.12, 0.12], center=true);
    }
    color([0.32, 0.35, 0.4], metalness=0.9, roughness=0.3, $asa=40) {
        translate([0, -2.2, 0.9]) {
            cylinder(h=0.35, r=0.45, center=true);
            translate([0.1, -0.6, 0.05]) rotate([90, 0, 0]) cylinder(h=0.9, r=0.07, center=true);
            translate([-0.1, -0.6, 0.05]) rotate([90, 0, 0]) cylinder(h=0.9, r=0.07, center=true);
        }
    }
}

armature(animations=anim) {
    main_hull();
    bone(name="ForwardTurret", t=[0, 1.8, 0.9], r=[0, 0, 0]) {
        color([0.35, 0.38, 0.44], metalness=0.9, roughness=0.3, $asa=40) {
            cylinder(h=0.38, r=0.48, center=true);
            translate([0.12, 0.7, 0.06]) rotate([90, 0, 0]) cylinder(h=1.0, r=0.075, center=true);
            translate([-0.12, 0.7, 0.06]) rotate([90, 0, 0]) cylinder(h=1.0, r=0.075, center=true);
        }
    }
}
`,
);

// ship_cruiser.scad - 3 cells (~5.2m long)
writeFile(
  "assets/models/ship_cruiser.scad",
  `// Heavy Cruiser (Size: 3 Cells = ~5.2m)
$fn = 18;

module cruiser() {
    color([0.28, 0.32, 0.36], metalness=0.8, roughness=0.4, $asa=35) {
        hull() {
            translate([0, -2.4, 0.35]) cube([1.2, 0.3, 0.7], center=true);
            translate([0, 0.0, 0.35]) cube([1.3, 2.5, 0.7], center=true);
            translate([0, 2.4, 0.35]) cube([0.25, 0.2, 0.7], center=true);
        }
    }
    color([0.22, 0.24, 0.28], metalness=0.6, roughness=0.5, $asa=30) {
        translate([0, 0.2, 0.95])
            cube([0.75, 1.8, 0.55], center=true);
        translate([0, -0.8, 1.05])
            cylinder(h=0.6, r=0.2, center=true);
    }
    color([0.4, 0.44, 0.48], metalness=0.9, roughness=0.3, $asa=35) {
        translate([0, 1.5, 0.85]) {
            cylinder(h=0.3, r=0.35, center=true);
            translate([0, 0.55, 0.05]) rotate([90, 0, 0]) cylinder(h=0.8, r=0.06, center=true);
        }
        translate([0, -1.6, 0.85]) {
            cube([0.6, 0.6, 0.25], center=true);
            translate([0, 0, 0.25]) sphere(r=0.25);
        }
    }
    color([0.0, 0.9, 0.8], metalness=0.4, roughness=0.2, emissive=[0.0, 0.9, 0.8], emissiveIntensity=1.4) {
        translate([0, 0.95, 1.05])
            cube([0.55, 0.1, 0.1], center=true);
    }
}

cruiser();
`,
);

// ship_destroyer.scad - 2 cells (~3.4m long)
writeFile(
  "assets/models/ship_destroyer.scad",
  `// Destroyer (Size: 2 Cells = ~3.4m)
$fn = 16;

module destroyer() {
    color([0.25, 0.3, 0.34], metalness=0.85, roughness=0.35, $asa=35) {
        hull() {
            translate([0, -1.5, 0.3]) cube([1.0, 0.3, 0.6], center=true);
            translate([0, 0.0, 0.3]) cube([1.05, 1.6, 0.6], center=true);
            translate([0, 1.5, 0.3]) cube([0.2, 0.1, 0.6], center=true);
        }
    }
    color([0.2, 0.23, 0.26], metalness=0.5, roughness=0.5, $asa=30) {
        translate([0, 0.1, 0.8])
            cube([0.65, 1.0, 0.45], center=true);
        translate([0, -0.5, 0.85])
            cylinder(h=0.45, r=0.15, center=true);
    }
    color([0.45, 0.48, 0.52], metalness=0.9, roughness=0.25, $asa=40) {
        translate([0, 0.95, 0.72]) {
            cylinder(h=0.24, r=0.28, center=true);
            translate([0, 0.4, 0.04]) rotate([90, 0, 0]) cylinder(h=0.6, r=0.05, center=true);
        }
    }
    color([0.15, 0.15, 0.15], metalness=0.8, roughness=0.4) {
        translate([0, -1.0, 0.68]) {
            rotate([0, 0, 90]) {
                translate([0.08, 0, 0]) cylinder(h=0.5, r=0.06, center=true);
                translate([-0.08, 0, 0]) cylinder(h=0.5, r=0.06, center=true);
            }
        }
    }
    color([0.0, 1.0, 0.6], metalness=0.2, roughness=0.2, emissive=[0.0, 1.0, 0.6], emissiveIntensity=1.6) {
        translate([0, 0.5, 0.85])
            cube([0.5, 0.08, 0.08], center=true);
    }
}

destroyer();
`,
);

// ship_patrol.scad - 1 cell (~1.5m long)
writeFile(
  "assets/models/ship_patrol.scad",
  `// Patrol Boat (Size: 1 Cell = ~1.5m)
$fn = 16;

module patrol_boat() {
    color([0.22, 0.28, 0.32], metalness=0.75, roughness=0.4, $asa=30) {
        hull() {
            translate([0, -0.65, 0.25]) cube([0.85, 0.2, 0.5], center=true);
            translate([0, 0.0, 0.25]) cube([0.9, 0.8, 0.5], center=true);
            translate([0, 0.65, 0.25]) cube([0.2, 0.1, 0.5], center=true);
        }
    }
    color([0.18, 0.2, 0.24], metalness=0.5, roughness=0.5, $asa=30) {
        translate([0, -0.05, 0.65])
            cube([0.55, 0.55, 0.35], center=true);
    }
    color([1.0, 0.6, 0.1], metalness=0.3, roughness=0.2, emissive=[1.0, 0.6, 0.1], emissiveIntensity=1.6) {
        translate([0, 0.2, 0.7])
            cube([0.45, 0.08, 0.12], center=true);
    }
    color([0.5, 0.55, 0.6], metalness=0.9, roughness=0.25) {
        translate([0, 0.45, 0.58]) {
            cylinder(h=0.18, r=0.16, center=true);
            translate([0, 0.22, 0.03]) rotate([90, 0, 0]) cylinder(h=0.35, r=0.035, center=true);
        }
    }
}

patrol_boat();
`,
);

// artillery_shell.scad - Naval shell projectile
writeFile(
  "assets/models/artillery_shell.scad",
  `// Ballistic Naval Artillery Shell
$fn = 18;

module shell() {
    color([0.85, 0.65, 0.2], metalness=0.9, roughness=0.3, $asa=45) {
        cylinder(h=0.5, r=0.12, center=true);
        translate([0, 0, 0.25])
            cylinder(h=0.35, r1=0.12, r2=0.01, center=true);
    }
    color([0.9, 0.45, 0.1], metalness=0.95, roughness=0.2) {
        translate([0, 0, -0.18])
            cylinder(h=0.08, r=0.125, center=true);
    }
    color([1.0, 0.6, 0.1], metalness=0.1, roughness=0.1, emissive=[1.0, 0.7, 0.1], emissiveIntensity=4.0) {
        translate([0, 0, -0.32])
            cylinder(h=0.2, r1=0.08, r2=0.01, center=true);
    }
}

rotate([-90, 0, 0])
    shell();
`,
);

// =========================================================================
// 3. GDSCRIPT LOGIC (ENGLISH)
// =========================================================================

writeFile(
  "scripts/grid_manager.gd",
  `class_name GridManager
extends RefCounted

const LETTERS: Array[String] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

const FLEET_DEFINITIONS: Array[Dictionary] = [
	{"name": "Battleship (4)", "size": 4, "scad": "res://assets/models/ship_battleship.scad"},
	{"name": "Cruiser (3)", "size": 3, "scad": "res://assets/models/ship_cruiser.scad"},
	{"name": "Cruiser (3)", "size": 3, "scad": "res://assets/models/ship_cruiser.scad"},
	{"name": "Destroyer (2)", "size": 2, "scad": "res://assets/models/ship_destroyer.scad"},
	{"name": "Destroyer (2)", "size": 2, "scad": "res://assets/models/ship_destroyer.scad"},
	{"name": "Destroyer (2)", "size": 2, "scad": "res://assets/models/ship_destroyer.scad"},
	{"name": "Patrol Boat (1)", "size": 1, "scad": "res://assets/models/ship_patrol.scad"},
	{"name": "Patrol Boat (1)", "size": 1, "scad": "res://assets/models/ship_patrol.scad"},
	{"name": "Patrol Boat (1)", "size": 1, "scad": "res://assets/models/ship_patrol.scad"},
	{"name": "Patrol Boat (1)", "size": 1, "scad": "res://assets/models/ship_patrol.scad"}
]

const GRID_SIZE = 10
const CELL_WORLD_SIZE = 2.0

class ShipData:
	var id: int
	var name: String
	var size: int
	var origin_x: int
	var origin_y: int
	var horizontal: bool
	var hits: int = 0
	var scad_path: String
	var node_ref: Node3D = null

	func is_sunk() -> bool:
		return hits >= size

	func get_occupied_cells() -> Array[Vector2i]:
		var cells: Array[Vector2i] = []
		for i in range(size):
			if horizontal:
				cells.append(Vector2i(origin_x + i, origin_y))
			else:
				cells.append(Vector2i(origin_x, origin_y + i))
		return cells

	func get_surrounding_cells() -> Array[Vector2i]:
		var surround: Array[Vector2i] = []
		var occupied = get_occupied_cells()
		for c in occupied:
			for dx in [-1, 0, 1]:
				for dy in [-1, 0, 1]:
					var neighbor = Vector2i(c.x + dx, c.y + dy)
					if neighbor.x >= 0 and neighbor.x < GRID_SIZE and neighbor.y >= 0 and neighbor.y < GRID_SIZE:
						if not occupied.has(neighbor) and not surround.has(neighbor):
							surround.append(neighbor)
		return surround

class BoardState:
	var shots: Dictionary = {}
	var ships: Array[ShipData] = []
	var cell_to_ship: Dictionary = {}

	func has_shot(x: int, y: int) -> bool:
		return shots.has(Vector2i(x, y))

	func get_all_sunk() -> bool:
		for s in ships:
			if not s.is_sunk():
				return false
		return ships.size() > 0

	func can_place_ship(ship_size: int, ox: int, oy: int, horizontal: bool) -> bool:
		for i in range(ship_size):
			var cx = ox + (i if horizontal else 0)
			var cy = oy + (0 if horizontal else i)
			if cx < 0 or cx >= GRID_SIZE or cy < 0 or cy >= GRID_SIZE:
				return false
			for dx in [-1, 0, 1]:
				for dy in [-1, 0, 1]:
					var test_pos = Vector2i(cx + dx, cy + dy)
					if cell_to_ship.has(test_pos):
						return false
		return true

	func add_ship(def: Dictionary, id: int, ox: int, oy: int, horizontal: bool) -> ShipData:
		var s = ShipData.new()
		s.id = id
		s.name = def["name"]
		s.size = def["size"]
		s.scad_path = def["scad"]
		s.origin_x = ox
		s.origin_y = oy
		s.horizontal = horizontal
		ships.append(s)
		for cell in s.get_occupied_cells():
			cell_to_ship[cell] = s
		return s

	func clear():
		shots.clear()
		ships.clear()
		cell_to_ship.clear()

static func generate_random_fleet(board: BoardState):
	board.clear()
	var rng = RandomNumberGenerator.new()
	rng.randomize()

	var ship_id = 0
	for def in FLEET_DEFINITIONS:
		var placed = false
		var attempts = 0
		while not placed and attempts < 1000:
			attempts += 1
			var horiz = rng.randi() % 2 == 0
			var max_x = (GRID_SIZE - def["size"]) if horiz else (GRID_SIZE - 1)
			var max_y = (GRID_SIZE - 1) if horiz else (GRID_SIZE - def["size"])
			var rx = rng.randi_range(0, max_x)
			var ry = rng.randi_range(0, max_y)
			if board.can_place_ship(def["size"], rx, ry, horiz):
				board.add_ship(def, ship_id, rx, ry, horiz)
				placed = true
				ship_id += 1
		if not placed:
			generate_random_fleet(board)
			return

static func grid_to_local_pos(x: int, y: int) -> Vector3:
	var local_x = (x - 4.5) * CELL_WORLD_SIZE
	var local_z = (y - 4.5) * CELL_WORLD_SIZE
	return Vector3(local_x, 0.1, local_z)

static func get_cell_name(cell: Vector2i) -> String:
	var col = LETTERS[clampi(cell.x, 0, 9)]
	var row = str(cell.y + 1)
	return col + "-" + row
`,
);

writeFile(
  "scripts/projectile.gd",
  `class_name ShellProjectile
extends Node3D

signal impacted(target_cell: Vector2i, is_hit: bool)

var start_pos: Vector3
var end_pos: Vector3
var arc_height: float = 9.0
var duration: float = 0.85
var elapsed: float = 0.0
var target_cell: Vector2i
var is_hit_result: bool

func launch(from_pt: Vector3, to_pt: Vector3, cell: Vector2i, hit: bool):
	start_pos = from_pt
	end_pos = to_pt
	target_cell = cell
	is_hit_result = hit
	global_position = start_pos
	set_process(true)

func _process(delta: float):
	elapsed += delta
	var t = clampf(elapsed / duration, 0.0, 1.0)

	var current_ground = start_pos.lerp(end_pos, t)
	var parabola = 4.0 * arc_height * t * (1.0 - t)
	var new_pos = Vector3(current_ground.x, current_ground.y + parabola, current_ground.z)

	var dir = (new_pos - global_position).normalized()
	if dir.length_squared() > 0.001 and abs(dir.dot(Vector3.UP)) < 0.99:
		look_at(global_position + dir, Vector3.UP)

	global_position = new_pos

	if t >= 1.0:
		impacted.emit(target_cell, is_hit_result)
		queue_free()
`,
);

writeFile(
  "scripts/audio_synth.gd",
  `class_name AudioSynth
extends Node

static func play_sound(parent: Node, sound_type: String):
	var player = AudioStreamPlayer.new()
	parent.add_child(player)
	player.stream = _create_stream(sound_type)
	player.play()
	player.finished.connect(func(): player.queue_free())

static func _create_stream(sound_type: String) -> AudioStreamWAV:
	var sample_rate = 22050
	var duration = 0.4
	if sound_type == "hit" or sound_type == "sunk":
		duration = 0.7
	elif sound_type == "fire":
		duration = 0.45
	elif sound_type == "miss":
		duration = 0.35
	else:
		duration = 0.15

	var total_samples = int(sample_rate * duration)
	var buffer = PackedByteArray()
	buffer.resize(total_samples * 2)

	for i in range(total_samples):
		var t = float(i) / float(sample_rate)
		var progress = float(i) / float(total_samples)
		var sample = 0.0

		if sound_type == "fire":
			var noise_val = randf_range(-1.0, 1.0)
			var boom = sin(t * 90.0 * TAU) * exp(-progress * 6.0)
			var crack = noise_val * exp(-progress * 14.0)
			sample = clampf(boom * 0.7 + crack * 0.5, -1.0, 1.0)

		elif sound_type == "hit":
			var noise_val = randf_range(-1.0, 1.0)
			var low = sin(t * 60.0 * TAU) * exp(-progress * 4.0)
			var rumble = noise_val * exp(-progress * 5.0)
			sample = clampf(low * 0.5 + rumble * 0.8, -1.0, 1.0)

		elif sound_type == "sunk":
			var noise_val = randf_range(-1.0, 1.0)
			var low = sin(t * 40.0 * TAU) * exp(-progress * 2.5)
			var roar = noise_val * exp(-progress * 3.5)
			sample = clampf(low * 0.6 + roar * 0.7, -1.0, 1.0)

		elif sound_type == "miss":
			var noise_val = randf_range(-1.0, 1.0)
			var splash = noise_val * sin(progress * PI) * exp(-progress * 7.0)
			sample = clampf(splash * 0.6, -1.0, 1.0)

		elif sound_type == "select":
			var freq = 1200.0 - progress * 400.0
			sample = sin(t * freq * TAU) * exp(-progress * 15.0) * 0.35

		elif sound_type == "win":
			var f = 440.0 + sin(progress * 12.0) * 80.0
			sample = sin(t * f * TAU) * (1.0 - progress) * 0.4

		var int_sample = int(clampf(sample, -1.0, 1.0) * 32767.0)
		buffer.encode_s16(i * 2, int_sample)

	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = buffer
	return stream
`,
);

writeFile(
  "scripts/battle_manager.gd",
  `extends Node3D

enum GamePhase { PLACEMENT, PLAYER_TURN, AI_TURN, GAME_OVER }

@export var player_board_root: Node3D
@export var enemy_board_root: Node3D
@export var camera: Camera3D
@export var status_label: Label
@export var info_banner: Label
@export var turn_indicator: Label
@export var player_sunk_count_lbl: Label
@export var enemy_sunk_count_lbl: Label
@export var btn_randomize: Button
@export var btn_start: Button
@export var btn_restart: Button
@export var reticle_node: Node3D

var player_board: GridManager.BoardState
var enemy_board: GridManager.BoardState

var current_phase: GamePhase = GamePhase.PLACEMENT
var hovered_grid_pos: Vector2i = Vector2i(4, 4)

# AI Hunt & Target state
var ai_target_candidates: Array[Vector2i] = []
var rng = RandomNumberGenerator.new()

var hit_marker_scene: PackedScene = preload("res://assets/models/marker_hit.scad")
var miss_marker_scene: PackedScene = preload("res://assets/models/marker_miss.scad")
var shell_scene: PackedScene = preload("res://assets/models/artillery_shell.scad")

func _ready():
	rng.randomize()
	player_board = GridManager.BoardState.new()
	enemy_board = GridManager.BoardState.new()

	if btn_randomize:
		btn_randomize.pressed.connect(_on_randomize_player_fleet)
	if btn_start:
		btn_start.pressed.connect(_on_start_battle)
	if btn_restart:
		btn_restart.pressed.connect(_restart_game)

	_on_randomize_player_fleet()
	GridManager.generate_random_fleet(enemy_board)

	_update_ui()
	_set_phase(GamePhase.PLACEMENT)
	_update_reticle_position()

func _on_randomize_player_fleet():
	if current_phase != GamePhase.PLACEMENT:
		return
	AudioSynth.play_sound(self, "select")
	_clear_rendered_ships(player_board_root)
	GridManager.generate_random_fleet(player_board)
	_render_player_ships()
	if info_banner:
		info_banner.text = "Fleet deployed! Press 'ENGAGE!' to commence the battle."

func _on_start_battle():
	if current_phase != GamePhase.PLACEMENT:
		return
	AudioSynth.play_sound(self, "fire")
	if btn_randomize:
		btn_randomize.visible = false
	if btn_start:
		btn_start.visible = false
	if reticle_node:
		reticle_node.visible = true
	_set_phase(GamePhase.PLAYER_TURN)
	_update_reticle_position()
	if info_banner:
		info_banner.text = "Your turn! Target: [" + GridManager.get_cell_name(hovered_grid_pos) + "]. Click Left Mouse or press SPACE to fire."

func _restart_game():
	get_tree().reload_current_scene()

func _set_phase(phase: GamePhase):
	current_phase = phase
	match current_phase:
		GamePhase.PLACEMENT:
			if turn_indicator:
				turn_indicator.text = "PHASE: DEPLOYMENT"
				turn_indicator.modulate = Color(0.3, 0.8, 1.0)
		GamePhase.PLAYER_TURN:
			if turn_indicator:
				turn_indicator.text = "YOUR TURN - SELECT TARGET"
				turn_indicator.modulate = Color(0.2, 1.0, 0.4)
			if reticle_node:
				reticle_node.visible = true
		GamePhase.AI_TURN:
			if turn_indicator:
				turn_indicator.text = "ENEMY TURN - INCOMING SALVO..."
				turn_indicator.modulate = Color(1.0, 0.35, 0.2)
			if reticle_node:
				reticle_node.visible = false
		GamePhase.GAME_OVER:
			if turn_indicator:
				turn_indicator.text = "BATTLE FINISHED"
			if reticle_node:
				reticle_node.visible = false
			if btn_restart:
				btn_restart.visible = true

func _unhandled_input(event: InputEvent):
	if current_phase == GamePhase.PLAYER_TURN:
		if event is InputEventMouseMotion:
			_update_raycast_cursor(event.position)
		elif event is InputEventMouseButton:
			if event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
				_handle_player_fire()
		elif event.is_action_pressed("ui_accept"):
			_handle_player_fire()
		elif event.is_action_pressed("ui_left"):
			_move_reticle_grid(-1, 0)
		elif event.is_action_pressed("ui_right"):
			_move_reticle_grid(1, 0)
		elif event.is_action_pressed("ui_up"):
			_move_reticle_grid(0, -1)
		elif event.is_action_pressed("ui_down"):
			_move_reticle_grid(0, 1)

func _move_reticle_grid(dx: int, dy: int):
	var nx = clampi(hovered_grid_pos.x + dx, 0, GridManager.GRID_SIZE - 1)
	var ny = clampi(hovered_grid_pos.y + dy, 0, GridManager.GRID_SIZE - 1)
	if nx != hovered_grid_pos.x or ny != hovered_grid_pos.y:
		hovered_grid_pos = Vector2i(nx, ny)
		AudioSynth.play_sound(self, "select")
		_update_reticle_position()

func _update_reticle_position():
	if reticle_node and enemy_board_root:
		var target_local = GridManager.grid_to_local_pos(hovered_grid_pos.x, hovered_grid_pos.y)
		reticle_node.global_position = enemy_board_root.to_global(target_local)
		if current_phase == GamePhase.PLAYER_TURN and info_banner:
			info_banner.text = "Target: Grid [" + GridManager.get_cell_name(hovered_grid_pos) + "]. Fire: Left Click or SPACE."

func _process(_delta: float):
	if current_phase == GamePhase.PLAYER_TURN and reticle_node and reticle_node.visible:
		var pulse = 1.0 + 0.08 * sin(Time.get_ticks_msec() * 0.008)
		reticle_node.scale = Vector3(pulse, 1.0, pulse)

	# Gentle flame flickering
	var time = Time.get_ticks_msec() * 0.001
	for fire in get_tree().get_nodes_in_group("fire_marker"):
		var flicker = sin(time * 14.0 + fire.global_position.x * 3.0) * 0.05
		fire.scale = Vector3(1.0 + flicker, 1.0 + flicker * 1.2, 1.0 + flicker)

func _update_raycast_cursor(screen_pos: Vector2):
	if not camera or not enemy_board_root:
		return

	var ray_origin = camera.project_ray_origin(screen_pos)
	var ray_dir = camera.project_ray_normal(screen_pos)

	if abs(ray_dir.y) < 0.001:
		return
	var t = -ray_origin.y / ray_dir.y
	if t < 0:
		return
	var hit_world = ray_origin + ray_dir * t

	var enemy_local = enemy_board_root.to_local(hit_world)
	if abs(enemy_local.x) <= 10.0 and abs(enemy_local.z) <= 10.0:
		var grid_x = int(floor((enemy_local.x + 10.0) / GridManager.CELL_WORLD_SIZE))
		var grid_y = int(floor((enemy_local.z + 10.0) / GridManager.CELL_WORLD_SIZE))
		grid_x = clampi(grid_x, 0, GridManager.GRID_SIZE - 1)
		grid_y = clampi(grid_y, 0, GridManager.GRID_SIZE - 1)

		if grid_x != hovered_grid_pos.x or grid_y != hovered_grid_pos.y:
			hovered_grid_pos = Vector2i(grid_x, grid_y)
			AudioSynth.play_sound(self, "select")
			_update_reticle_position()

func _handle_player_fire():
	if enemy_board.has_shot(hovered_grid_pos.x, hovered_grid_pos.y):
		if info_banner:
			info_banner.text = "Grid [" + GridManager.get_cell_name(hovered_grid_pos) + "] has already been targeted! Choose another sector."
		return

	_set_phase(GamePhase.AI_TURN)
	if turn_indicator:
		turn_indicator.text = "FIRING SALVO..."

	var is_hit = enemy_board.cell_to_ship.has(hovered_grid_pos)
	var from_world = player_board_root.global_position + Vector3(0, 4.0, -2.0)
	var to_world = enemy_board_root.to_global(GridManager.grid_to_local_pos(hovered_grid_pos.x, hovered_grid_pos.y))

	_spawn_shell_trajectory(from_world, to_world, hovered_grid_pos, is_hit, true)

func _on_player_shot_impact(target_cell: Vector2i, is_hit: bool):
	enemy_board.shots[target_cell] = 2 if is_hit else 1
	var marker_pos = GridManager.grid_to_local_pos(target_cell.x, target_cell.y)

	if is_hit:
		var ship: GridManager.ShipData = enemy_board.cell_to_ship[target_cell]
		ship.hits += 1
		_spawn_marker(enemy_board_root, marker_pos, true)

		if ship.is_sunk():
			AudioSynth.play_sound(self, "sunk")
			if info_banner:
				info_banner.text = "SUNK! Enemy " + ship.name + " has been destroyed!"
			_render_sunk_enemy_ship(ship)
			for sc in ship.get_surrounding_cells():
				if not enemy_board.has_shot(sc.x, sc.y):
					enemy_board.shots[sc] = 1
					var s_pos = GridManager.grid_to_local_pos(sc.x, sc.y)
					_spawn_marker(enemy_board_root, s_pos, false)
		else:
			AudioSynth.play_sound(self, "hit")
			if info_banner:
				info_banner.text = "DIRECT HIT on " + ship.name + "! Bonus turn granted!"

		_update_ui()

		if enemy_board.get_all_sunk():
			_trigger_victory()
			return

		_set_phase(GamePhase.PLAYER_TURN)
		if turn_indicator:
			turn_indicator.text = "DIRECT HIT! BONUS SALVO!"
	else:
		AudioSynth.play_sound(self, "miss")
		_spawn_marker(enemy_board_root, marker_pos, false)
		if info_banner:
			info_banner.text = "SPLASH! Shell missed. Enemy counter-battery firing."
		_update_ui()
		get_tree().create_timer(1.1).timeout.connect(_execute_ai_turn)

func _execute_ai_turn():
	if current_phase == GamePhase.GAME_OVER:
		return
	_set_phase(GamePhase.AI_TURN)

	var target_cell = _calculate_ai_target()
	var is_hit = player_board.cell_to_ship.has(target_cell)

	var from_world = enemy_board_root.global_position + Vector3(0, 4.0, 2.0)
	var to_world = player_board_root.to_global(GridManager.grid_to_local_pos(target_cell.x, target_cell.y))

	_spawn_shell_trajectory(from_world, to_world, target_cell, is_hit, false)

func _calculate_ai_target() -> Vector2i:
	while ai_target_candidates.size() > 0:
		var cand = ai_target_candidates.pop_front()
		if not player_board.has_shot(cand.x, cand.y):
			return cand

	var untried_parity: Array[Vector2i] = []
	var untried_all: Array[Vector2i] = []

	for x in range(GridManager.GRID_SIZE):
		for y in range(GridManager.GRID_SIZE):
			var c = Vector2i(x, y)
			if not player_board.has_shot(x, y):
				untried_all.append(c)
				if (x + y) % 2 == 0:
					untried_parity.append(c)

	if untried_parity.size() > 0:
		return untried_parity[rng.randi() % untried_parity.size()]
	elif untried_all.size() > 0:
		return untried_all[rng.randi() % untried_all.size()]
	return Vector2i(0, 0)

func _on_ai_shot_impact(target_cell: Vector2i, is_hit: bool):
	player_board.shots[target_cell] = 2 if is_hit else 1
	var marker_pos = GridManager.grid_to_local_pos(target_cell.x, target_cell.y)

	if is_hit:
		var ship: GridManager.ShipData = player_board.cell_to_ship[target_cell]
		ship.hits += 1
		_spawn_marker(player_board_root, marker_pos, true)

		for delta in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var adj = target_cell + delta
			if adj.x >= 0 and adj.x < GridManager.GRID_SIZE and adj.y >= 0 and adj.y < GridManager.GRID_SIZE:
				if not player_board.has_shot(adj.x, adj.y) and not ai_target_candidates.has(adj):
					ai_target_candidates.append(adj)

		if ship.is_sunk():
			AudioSynth.play_sound(self, "sunk")
			if info_banner:
				info_banner.text = "CRITICAL LOSS! Our " + ship.name + " has been sunk!"
			for sc in ship.get_surrounding_cells():
				if not player_board.has_shot(sc.x, sc.y):
					player_board.shots[sc] = 1
					var s_pos = GridManager.grid_to_local_pos(sc.x, sc.y)
					_spawn_marker(player_board_root, s_pos, false)
					ai_target_candidates.erase(sc)
		else:
			AudioSynth.play_sound(self, "hit")
			if info_banner:
				info_banner.text = "WARNING! Enemy shell struck our " + ship.name + "!"

		_update_ui()

		if player_board.get_all_sunk():
			_trigger_defeat()
			return

		get_tree().create_timer(1.1).timeout.connect(_execute_ai_turn)
	else:
		AudioSynth.play_sound(self, "miss")
		_spawn_marker(player_board_root, marker_pos, false)
		if info_banner:
			info_banner.text = "Enemy missed at sector [" + GridManager.get_cell_name(target_cell) + "]! Your turn."
		_update_ui()
		_set_phase(GamePhase.PLAYER_TURN)

func _spawn_shell_trajectory(from_pt: Vector3, to_pt: Vector3, target_cell: Vector2i, is_hit: bool, is_player_shooting: bool):
	AudioSynth.play_sound(self, "fire")
	var shell_instance = shell_scene.instantiate()
	var projectile = ShellProjectile.new()
	projectile.add_child(shell_instance)
	add_child(projectile)

	if is_player_shooting:
		projectile.impacted.connect(_on_player_shot_impact)
	else:
		projectile.impacted.connect(_on_ai_shot_impact)

	projectile.launch(from_pt, to_pt, target_cell, is_hit)

func _spawn_marker(board_root: Node3D, local_pos: Vector3, is_hit: bool):
	var marker = (hit_marker_scene if is_hit else miss_marker_scene).instantiate()
	board_root.add_child(marker)
	if is_hit:
		# Elevated slightly so the buoy base sits visibly on decks and spires rise high
		marker.position = Vector3(local_pos.x, 0.25, local_pos.z)
		marker.add_to_group("fire_marker")
	else:
		marker.position = Vector3(local_pos.x, 0.05, local_pos.z)

func _clear_rendered_ships(board_root: Node3D):
	if not board_root:
		return
	for child in board_root.get_children():
		if child.is_in_group("ship_model"):
			child.queue_free()

func _render_player_ships():
	if not player_board_root:
		return
	for ship in player_board.ships:
		var ship_scene = load(ship.scad_path) as PackedScene
		if ship_scene:
			var instance = ship_scene.instantiate()
			instance.add_to_group("ship_model")
			player_board_root.add_child(instance)

			var length_offset = (ship.size - 1) * 0.5
			var center_x = ship.origin_x + (length_offset if ship.horizontal else 0.0)
			var center_y = ship.origin_y + (0.0 if ship.horizontal else length_offset)

			instance.position = Vector3(
				(center_x - 4.5) * GridManager.CELL_WORLD_SIZE,
				0.05,
				(center_y - 4.5) * GridManager.CELL_WORLD_SIZE
			)

			if ship.horizontal:
				instance.rotation_degrees.y = 90.0
			else:
				instance.rotation_degrees.y = 0.0

			var anim_player: AnimationPlayer = instance.find_child("AnimationPlayer", true, false)
			if anim_player:
				var anim_list = anim_player.get_animation_list()
				if anim_list.size() > 0:
					var anim_name = anim_list[0]
					var anim = anim_player.get_animation(anim_name)
					if anim:
						anim.loop_mode = Animation.LOOP_LINEAR
					anim_player.play(anim_name)

			ship.node_ref = instance

func _render_sunk_enemy_ship(ship: GridManager.ShipData):
	if not enemy_board_root:
		return
	var ship_scene = load(ship.scad_path) as PackedScene
	if ship_scene:
		var instance = ship_scene.instantiate()
		instance.add_to_group("ship_model")
		enemy_board_root.add_child(instance)

		var length_offset = (ship.size - 1) * 0.5
		var center_x = ship.origin_x + (length_offset if ship.horizontal else 0.0)
		var center_y = ship.origin_y + (0.0 if ship.horizontal else length_offset)

		instance.position = Vector3(
			(center_x - 4.5) * GridManager.CELL_WORLD_SIZE,
			0.02,
			(center_y - 4.5) * GridManager.CELL_WORLD_SIZE
		)

		if ship.horizontal:
			instance.rotation_degrees.y = 90.0
		else:
			instance.rotation_degrees.y = 0.0

		instance.scale = Vector3(0.95, 0.6, 0.95)

func _update_ui():
	var p_sunk = 0
	for s in player_board.ships:
		if s.is_sunk():
			p_sunk += 1

	var e_sunk = 0
	for s in enemy_board.ships:
		if s.is_sunk():
			e_sunk += 1

	if player_sunk_count_lbl:
		player_sunk_count_lbl.text = "Losses: %d / %d" % [p_sunk, player_board.ships.size()]
	if enemy_sunk_count_lbl:
		enemy_sunk_count_lbl.text = "Sunk: %d / %d" % [e_sunk, enemy_board.ships.size()]

func _trigger_victory():
	_set_phase(GamePhase.GAME_OVER)
	AudioSynth.play_sound(self, "win")
	if info_banner:
		info_banner.text = "VICTORY! The entire enemy armada has been sunk! Complete naval supremacy achieved!"
	if turn_indicator:
		turn_indicator.text = "VICTORY AT SEA!"
		turn_indicator.modulate = Color(1.0, 0.9, 0.1)

func _trigger_defeat():
	_set_phase(GamePhase.GAME_OVER)
	AudioSynth.play_sound(self, "sunk")
	if info_banner:
		info_banner.text = "DEFEAT! All our warships have been destroyed. Fleet ordered to retreat."
	if turn_indicator:
		turn_indicator.text = "DEFEAT"
		turn_indicator.modulate = Color(1.0, 0.2, 0.2)
`,
);

// =========================================================================
// 4. MAIN SCENE (.tscn)
// =========================================================================

writeFile(
  "scenes/main_scene.tscn",
  `[gd_scene load_steps=10 format=3 uid="uid://c65j2xnv44v8b"]

[ext_resource type="Script" path="res://scripts/battle_manager.gd" id="1_battle"]
[ext_resource type="PackedScene" path="res://assets/models/ocean_grid_table.scad" id="2_ocean"]
[ext_resource type="PackedScene" path="res://assets/models/targeting_reticle.scad" id="3_reticle"]

[sub_resource type="ProceduralSkyMaterial" id="ProceduralSkyMaterial_sky"]
sky_top_color = Color(0.12, 0.25, 0.45, 1)
sky_horizon_color = Color(0.4, 0.6, 0.75, 1)
ground_bottom_color = Color(0.08, 0.15, 0.25, 1)
ground_horizon_color = Color(0.3, 0.5, 0.65, 1)

[sub_resource type="Sky" id="Sky_env"]
sky_material = SubResource("ProceduralSkyMaterial_sky")

[sub_resource type="Environment" id="Environment_main"]
background_mode = 2
sky = SubResource("Sky_env")
ambient_light_source = 3
ambient_light_color = Color(0.65, 0.75, 0.85, 1)
ambient_light_energy = 0.9
tonemap_mode = 3
glow_enabled = true
glow_intensity = 0.5
glow_bloom = 0.2

[sub_resource type="LabelSettings" id="LabelSettings_title"]
font_size = 30
font_color = Color(0.9, 0.95, 1, 1)
outline_size = 4
outline_color = Color(0.05, 0.15, 0.25, 1)

[sub_resource type="LabelSettings" id="LabelSettings_turn"]
font_size = 22
font_color = Color(0.2, 0.9, 1, 1)
outline_size = 3
outline_color = Color(0.02, 0.1, 0.2, 1)

[sub_resource type="LabelSettings" id="LabelSettings_banner"]
font_size = 19
font_color = Color(1, 0.95, 0.8, 1)
outline_size = 3
outline_color = Color(0.1, 0.1, 0.15, 1)

[node name="MainScene" type="Node3D" node_paths=PackedStringArray("player_board_root", "enemy_board_root", "camera", "status_label", "info_banner", "turn_indicator", "player_sunk_count_lbl", "enemy_sunk_count_lbl", "btn_randomize", "btn_start", "btn_restart", "reticle_node")]
script = ExtResource("1_battle")
player_board_root = NodePath("PlayerBoardRoot")
enemy_board_root = NodePath("EnemyBoardRoot")
camera = NodePath("Camera3D")
status_label = NodePath("UI/TopBar/TitleLabel")
info_banner = NodePath("UI/BottomBar/InfoBanner")
turn_indicator = NodePath("UI/TopBar/TurnIndicator")
player_sunk_count_lbl = NodePath("UI/PlayerStats/VBox/PlayerLosses")
enemy_sunk_count_lbl = NodePath("UI/EnemyStats/VBox/EnemyLosses")
btn_randomize = NodePath("UI/Controls/BtnRandomize")
btn_start = NodePath("UI/Controls/BtnStart")
btn_restart = NodePath("UI/Controls/BtnRestart")
reticle_node = NodePath("ReticleNode")

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_main")

[node name="DirectionalLight3D" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.866025, -0.353553, 0.353553, 0, 0.707107, 0.707107, -0.5, -0.612372, 0.612372, 12, 25, 15)
light_color = Color(1, 0.95, 0.9, 1)
light_energy = 1.3
shadow_enabled = true

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.587785, 0.809017, 0, -0.809017, 0.587785, 0, 36, 26)
fov = 48.0

[node name="PlayerBoardRoot" type="Node3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -12.5, 0, 0)

[node name="OceanTable" parent="PlayerBoardRoot" instance=ExtResource("2_ocean")]

[node name="EnemyBoardRoot" type="Node3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 12.5, 0, 0)

[node name="OceanTable" parent="EnemyBoardRoot" instance=ExtResource("2_ocean")]

[node name="ReticleNode" type="Node3D" parent="."]
visible = false

[node name="ReticleMesh" parent="ReticleNode" instance=ExtResource("3_reticle")]

[node name="UI" type="Control" parent="."]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2

[node name="TopBar" type="VBoxContainer" parent="UI"]
layout_mode = 1
anchors_preset = 10
anchor_right = 1.0
offset_bottom = 85.0
grow_horizontal = 2
theme_override_constants/separation = 4

[node name="TitleLabel" type="Label" parent="UI/TopBar"]
layout_mode = 2
text = "BATTLESHIP 3D"
label_settings = SubResource("LabelSettings_title")
horizontal_alignment = 1

[node name="TurnIndicator" type="Label" parent="UI/TopBar"]
layout_mode = 2
text = "PHASE: DEPLOYMENT"
label_settings = SubResource("LabelSettings_turn")
horizontal_alignment = 1

[node name="PlayerStats" type="PanelContainer" parent="UI"]
layout_mode = 1
anchors_preset = 4
anchor_top = 0.5
anchor_bottom = 0.5
offset_left = 24.0
offset_top = -60.0
offset_right = 260.0
offset_bottom = 60.0
grow_vertical = 2

[node name="VBox" type="VBoxContainer" parent="UI/PlayerStats"]
layout_mode = 2
alignment = 1

[node name="Label" type="Label" parent="UI/PlayerStats/VBox"]
layout_mode = 2
text = "OUR FLEET (PLAYER)"
horizontal_alignment = 1

[node name="PlayerLosses" type="Label" parent="UI/PlayerStats/VBox"]
layout_mode = 2
text = "Losses: 0 / 10"
horizontal_alignment = 1

[node name="EnemyStats" type="PanelContainer" parent="UI"]
layout_mode = 1
anchors_preset = 6
anchor_top = 0.5
anchor_right = 1.0
anchor_bottom = 0.5
offset_left = -260.0
offset_top = -60.0
offset_right = -24.0
offset_bottom = 60.0
grow_horizontal = 0
grow_vertical = 2

[node name="VBox" type="VBoxContainer" parent="UI/EnemyStats"]
layout_mode = 2
alignment = 1

[node name="Label" type="Label" parent="UI/EnemyStats/VBox"]
layout_mode = 2
text = "ENEMY FLEET"
horizontal_alignment = 1

[node name="EnemyLosses" type="Label" parent="UI/EnemyStats/VBox"]
layout_mode = 2
text = "Sunk: 0 / 10"
horizontal_alignment = 1

[node name="BottomBar" type="VBoxContainer" parent="UI"]
layout_mode = 1
anchors_preset = 12
anchor_top = 1.0
anchor_right = 1.0
anchor_bottom = 1.0
offset_top = -120.0
offset_bottom = -20.0
grow_horizontal = 2
grow_vertical = 0
alignment = 1

[node name="InfoBanner" type="Label" parent="UI/BottomBar"]
layout_mode = 2
text = "Deploy your fleet and prepare for naval battle!"
label_settings = SubResource("LabelSettings_banner")
horizontal_alignment = 1

[node name="Controls" type="HBoxContainer" parent="UI"]
layout_mode = 1
anchors_preset = 7
anchor_left = 0.5
anchor_top = 1.0
anchor_right = 0.5
anchor_bottom = 1.0
offset_left = -250.0
offset_top = -65.0
offset_right = 250.0
offset_bottom = -15.0
grow_horizontal = 2
grow_vertical = 0
theme_override_constants/separation = 20
alignment = 1

[node name="BtnRandomize" type="Button" parent="UI/Controls"]
custom_minimum_size = Vector2(175, 45)
layout_mode = 2
text = "Randomize Fleet"

[node name="BtnStart" type="Button" parent="UI/Controls"]
custom_minimum_size = Vector2(140, 45)
layout_mode = 2
text = "ENGAGE!"

[node name="BtnRestart" type="Button" parent="UI/Controls"]
visible = false
custom_minimum_size = Vector2(160, 45)
layout_mode = 2
text = "Play Again"
`,
);

// =========================================================================
// 5. PROJECT CONFIG & README
// =========================================================================

writeFile(
  "project.godot",
  `config_version=5

[application]

config/name="Battleship 3D"
config/description="3D Naval Battleship game featuring procedural OpenSCAD warships and tactical AI"
run/main_scene="res://scenes/main_scene.tscn"
config/features=PackedStringArray("4.3", "Forward Plus")

[display]

window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"

[editor_plugins]

enabled=PackedStringArray("res://addons/scad_importer/plugin.cfg")

[rendering]

anti_aliasing/quality/msaa_3d=2
anti_aliasing/quality/screen_space_aa=1
`,
);

writeFile(
  ".gitignore",
  `.godot/
*.translation
*.tmp
scad_cache_*
`,
);

writeFile(
  "README.md",
  `# Battleship 3D

Tactical 3D Battleship game built for Godot 4 using procedural OpenSCAD 3D models.

## Features
- **10 Ships Classic Armada**:
  - 1 × Battleship (4 cells)
  - 2 × Cruisers (3 cells)
  - 3 × Destroyers (2 cells)
  - 4 × Patrol Boats (1 cell)
- **Standard Clearance Rules**: Ships cannot touch horizontally, vertically, or diagonally. Sunk enemy ships are automatically ringed with miss markers.
- **Smart Tactical AI**: Uses a Hunt-and-Target algorithm with checkerboard parity scanning followed by cardinal searches on hits.
- **Elevated Flame Spires**: Beautiful glowing crimson and plasma crystal flame pillars rising ~2.8 meters so they remain clearly visible above ship decks and bridge superstructures.
- **Accurate HUD Reticle**: Inward-framing bracket corners precisely defining the targeted 2x2m sector.
- **Controls**:
  - **Mouse**: Aim at the enemy grid and click Left Mouse Button to fire.
  - **Keyboard**: Use Arrow Keys / WASD to move the reticle across sectors A-1 through J-10, and press Space or Enter to fire.
`,
);

console.log(`\nUpdated all files successfully in '${ROOT_DIR}/'!`);
