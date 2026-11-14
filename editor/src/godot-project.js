import { convertScadToGltf } from "scad-gltf/convert";
import {
  extractFilesFromMarkdown,
  extractScadDependencies,
} from "scad-gltf/utils";
import { buildGodotPck } from "./godot-pck.js";

const RUNTIME_LOADER_PATH = "__scad_runtime_loader.gd";

const RUNTIME_LOADER_GDSCRIPT = `extends Node

class ScadRuntimeFormatLoader extends ResourceFormatLoader:
\tfunc _get_recognized_extensions() -> PackedStringArray:
\t\treturn PackedStringArray(["scad", "glb", "gltf", "png", "jpg", "jpeg", "webp", "svg"])

\tfunc _handles_type(type: StringName) -> bool:
\t\treturn type == &"" or type == &"PackedScene" or type == &"Resource" or type == &"Node" or type == &"Texture2D" or type == &"CompressedTexture2D" or type == &"Image"

\tfunc _get_resource_type(path: String) -> String:
\t\tvar ext := path.get_extension().to_lower()
\t\tif ext in ["scad", "glb", "gltf"]:
\t\t\treturn "PackedScene"
\t\tif ext in ["png", "jpg", "jpeg", "webp", "svg"]:
\t\t\treturn "ImageTexture"
\t\treturn ""

\tfunc _exists(path: String) -> bool:
\t\tif path.get_extension().to_lower() == "scad":
\t\t\treturn FileAccess.file_exists(_get_scad_glb_path(path))
\t\treturn FileAccess.file_exists(path)

\tfunc _get_scad_glb_path(path: String) -> String:
\t\tvar rel := path
\t\tif rel.begins_with("res://"):
\t\t\trel = rel.substr(6)
\t\treturn "res://__scad_glbs/" + rel + ".glb"

\tfunc _set_owner_recursive(node: Node, new_owner: Node) -> void:
\t\tfor child in node.get_children():
\t\t\tchild.owner = new_owner
\t\t\t_set_owner_recursive(child, new_owner)

\tfunc _load(path: String, _original_path: String, _use_sub_threads: bool, _cache_mode: int) -> Variant:
\t\tvar ext := path.get_extension().to_lower()

\t\tif ext in ["png", "jpg", "jpeg", "webp", "svg"]:
\t\t\tvar img_bytes := FileAccess.get_file_as_bytes(path)
\t\t\tif img_bytes.is_empty():
\t\t\t\treturn ERR_FILE_NOT_FOUND
\t\t\tvar img := Image.new()
\t\t\tvar err := OK
\t\t\tif ext == "png":
\t\t\t\terr = img.load_png_from_buffer(img_bytes)
\t\t\telif ext == "jpg" or ext == "jpeg":
\t\t\t\terr = img.load_jpg_from_buffer(img_bytes)
\t\t\telif ext == "webp":
\t\t\t\terr = img.load_webp_from_buffer(img_bytes)
\t\t\telif ext == "svg":
\t\t\t\terr = img.load_svg_from_buffer(img_bytes)
\t\t\tif err != OK:
\t\t\t\treturn err
\t\t\treturn ImageTexture.create_from_image(img)

\t\tif ext in ["scad", "glb", "gltf"]:
\t\t\tvar target_path := _get_scad_glb_path(path) if ext == "scad" else path
\t\t\tif not FileAccess.file_exists(target_path):
\t\t\t\tpush_error("[ScadWeb] Missing compiled GLB for: " + path + " (expected " + target_path + ")")
\t\t\t\treturn ERR_FILE_NOT_FOUND

\t\t\tvar bytes := FileAccess.get_file_as_bytes(target_path)
\t\t\tif bytes.is_empty():
\t\t\t\treturn ERR_FILE_CORRUPT

\t\t\tvar doc := GLTFDocument.new()
\t\t\tvar state := GLTFState.new()
\t\t\tvar err := OK
\t\t\tif ext == "gltf":
\t\t\t\terr = doc.append_from_buffer(bytes, target_path.get_base_dir(), state)
\t\t\telse:
\t\t\t\terr = doc.append_from_buffer(bytes, "", state)

\t\t\tif err != OK:
\t\t\t\tpush_error("[ScadWeb] GLTFDocument failed to parse " + path + " (err=" + str(err) + ")")
\t\t\t\treturn err

\t\t\tvar root := doc.generate_scene(state)
\t\t\tif root == null:
\t\t\t\tpush_error("[ScadWeb] GLTFDocument failed to generate scene for " + path)
\t\t\t\treturn ERR_CANT_CREATE

\t\t\t_set_owner_recursive(root, root)

\t\t\tvar packed := PackedScene.new()
\t\t\tvar pack_err := packed.pack(root)
\t\t\troot.free()
\t\t\tif pack_err != OK:
\t\t\t\tpush_error("[ScadWeb] Failed to pack scene for " + path + " (err=" + str(pack_err) + ")")
\t\t\t\treturn pack_err

\t\t\treturn packed

\t\treturn ERR_FILE_UNRECOGNIZED

var _loader: ScadRuntimeFormatLoader

func _init() -> void:
\t_loader = ScadRuntimeFormatLoader.new()
\tResourceLoader.add_resource_format_loader(_loader, true)

func _exit_tree() -> void:
\tif _loader != null:
\t\tResourceLoader.remove_resource_format_loader(_loader)
\t\t_loader = null
`;

function resolvePosixPath(baseDir, relPath) {
  const stack = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const part of relPath.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function getDirname(filePath) {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

/**
 * Detects whether a markdown string contains a Godot project (project.godot).
 * Returns normalized relative project files if found, otherwise null.
 */
export function parseGodotMarkdownProject(mdContent) {
  if (
    typeof mdContent !== "string" ||
    !mdContent.includes("###") ||
    !mdContent.includes("```")
  ) {
    return null;
  }

  const rawFiles = extractFilesFromMarkdown(mdContent);
  const paths = Object.keys(rawFiles);
  if (paths.length === 0) return null;

  const projectGodotPaths = paths
    .filter((p) => {
      const normalized = p.replace(/\\/g, "/");
      return (
        normalized === "project.godot" || normalized.endsWith("/project.godot")
      );
    })
    .sort((a, b) => a.length - b.length);

  if (projectGodotPaths.length === 0) return null;

  const projectGodotPath = projectGodotPaths[0].replace(/\\/g, "/");
  const rootPrefix =
    projectGodotPath === "project.godot"
      ? ""
      : projectGodotPath.slice(0, -"project.godot".length);

  const projectName = rootPrefix
    ? rootPrefix.replace(/\/$/, "").split("/").pop()
    : "godot_project";

  const files = {};
  for (const [origPath, content] of Object.entries(rawFiles)) {
    const norm = origPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (rootPrefix && !norm.startsWith(rootPrefix)) continue;
    const relPath = rootPrefix ? norm.slice(rootPrefix.length) : norm;
    if (!relPath) continue;
    files[relPath] = content;
  }

  return {
    isGodotProject: true,
    projectName,
    rootPrefix,
    files,
  };
}

function resolveScadDepsForGodotFile(entryRelPath, projectFiles) {
  const additionalFiles = {};
  const visitedRepoPaths = new Set();

  function walk(repoFilePath, vfsDir) {
    if (visitedRepoPaths.has(repoFilePath)) return;
    visitedRepoPaths.add(repoFilePath);

    const code = projectFiles[repoFilePath];
    if (typeof code !== "string") return;

    const repoDir = getDirname(repoFilePath);
    const deps = extractScadDependencies(code);

    for (const rawDep of deps) {
      const normalizedDep = rawDep.replace(/\\/g, "/");
      let resolvedRepoPath = resolvePosixPath(repoDir, normalizedDep);
      if (projectFiles[resolvedRepoPath] === undefined) {
        if (projectFiles[normalizedDep] !== undefined) {
          resolvedRepoPath = normalizedDep;
        } else {
          continue;
        }
      }

      const vfsPath = vfsDir
        ? resolvePosixPath(vfsDir, normalizedDep)
        : normalizedDep;
      additionalFiles[vfsPath] = projectFiles[resolvedRepoPath];

      walk(resolvedRepoPath, getDirname(vfsPath));
    }
  }

  walk(entryRelPath, "");
  return additionalFiles;
}

function collectReferencedScadPaths(projectFiles) {
  const referenced = new Set();
  const scadRefRegex = /(?:res:\/\/)?([A-Za-z0-9_./-]+\.scad)/g;

  for (const [relPath, content] of Object.entries(projectFiles)) {
    const lower = relPath.toLowerCase();
    if (
      lower.endsWith(".tscn") ||
      lower.endsWith(".tres") ||
      lower.endsWith(".gd") ||
      lower.endsWith(".godot")
    ) {
      let match;
      while ((match = scadRefRegex.exec(content)) !== null) {
        referenced.add(match[1].replace(/^\/+/, ""));
      }
    }
  }
  return referenced;
}

function patchProjectGodot(rawContent) {
  let content = rawContent.replace(/\r\n/g, "\n");
  const autoloadLine = `ScadRuntimeLoader="*res://${RUNTIME_LOADER_PATH}"`;

  if (/^\[autoload\]/m.test(content)) {
    content = content.replace(
      /^\[autoload\]\s*\n?/m,
      `[autoload]\n${autoloadLine}\n`,
    );
  } else {
    content += `\n[autoload]\n${autoloadLine}\n`;
  }

  // Ensure WebGL2 (gl_compatibility) renderer is selected on web builds
  if (!/renderer\/rendering_method\.web\s*=/.test(content)) {
    if (/^\[rendering\]/m.test(content)) {
      content = content.replace(
        /^\[rendering\]\s*\n?/m,
        `[rendering]\nrenderer/rendering_method.web="gl_compatibility"\n`,
      );
    } else {
      content += `\n[rendering]\nrenderer/rendering_method.web="gl_compatibility"\n`;
    }
  }

  return content;
}

/**
 * Compiles all .scad assets in the Godot project to .glb via OpenSCAD WASM,
 * injects the runtime SCAD loader, and builds an in-memory .pck buffer.
 */
export async function compileGodotProjectToPck(project, options = {}) {
  const { wasmUrl, onProgress, scadCache = new Map() } = options;
  const pckFiles = new Map();
  const logs = [];

  const scadPaths = Object.keys(project.files).filter((p) =>
    p.toLowerCase().endsWith(".scad"),
  );
  const referencedScads = collectReferencedScadPaths(project.files);

  let compiledCount = 0;
  for (let i = 0; i < scadPaths.length; i++) {
    const scadPath = scadPaths[i];
    if (onProgress) {
      onProgress(`Compiling SCAD (${i + 1}/${scadPaths.length}): ${scadPath}`);
    }

    const scadCode = project.files[scadPath];
    const additionalFiles = resolveScadDepsForGodotFile(
      scadPath,
      project.files,
    );
    const cacheKey = JSON.stringify({
      scadPath,
      scadCode,
      additionalFiles,
    });

    let glbData = scadCache.get(cacheKey);
    if (!glbData) {
      try {
        glbData = await convertScadToGltf(scadCode, {
          wasmUrl,
          additionalFiles,
        });
        scadCache.set(cacheKey, glbData);
      } catch (err) {
        const errMsg = err?.message || String(err);
        const isEmptyObj = /empty/i.test(errMsg);
        if (isEmptyObj && !referencedScads.has(scadPath)) {
          logs.push(
            `[SCAD] Skipped helper library ${scadPath} (no top-level geometry).`,
          );
          continue;
        }
        throw new Error(`Failed compiling ${scadPath}: ${errMsg}`);
      }
    }

    pckFiles.set(`res://__scad_glbs/${scadPath}.glb`, glbData);
    compiledCount++;
  }

  for (const [relPath, content] of Object.entries(project.files)) {
    if (relPath.startsWith("addons/scad_importer/")) {
      continue;
    }
    if (relPath === "project.godot") {
      pckFiles.set(`res://${relPath}`, patchProjectGodot(content));
    } else {
      pckFiles.set(`res://${relPath}`, content);
    }
  }

  pckFiles.set(`res://${RUNTIME_LOADER_PATH}`, RUNTIME_LOADER_GDSCRIPT);

  if (onProgress) {
    onProgress("Packing Godot project (.pck)...");
  }

  const pckBuffer = buildGodotPck(pckFiles);
  return { pckBuffer, logs, compiledCount };
}
