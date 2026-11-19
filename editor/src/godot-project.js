import { convertScadToGltf } from "scad-gltf/convert";
import {
  extractFilesFromMarkdown,
  extractScadDependencies,
  isScadFilePath,
} from "scad-gltf/utils";
import { buildGodotPck } from "./godot-pck.js";
import { GODOT_ADDON_FILES } from "./prompt-ui.js";
import JSZip from "jszip";

const RUNTIME_LOADER_PATH = "__scad_runtime_loader.gd";
const GLOBAL_SCRIPT_CLASS_CACHE_PATH = ".godot/global_script_class_cache.cfg";

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

function escapeGdConfigString(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function stripGdComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && (inSingle || inDouble)) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseGdScriptClassInfo(relPath, source) {
  if (typeof source !== "string") return null;

  let className = null;
  let baseName = "RefCounted";
  let icon = "";
  let isTool = false;
  let isAbstract = false;

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (const rawLine of lines) {
    // Only inspect unindented top-level statements so inner classes are ignored
    if (/^[ \t]/.test(rawLine)) continue;

    const line = stripGdComment(rawLine).trim();
    if (!line) continue;

    if (/^@tool\b/.test(line)) isTool = true;
    if (/^@abstract\b/.test(line)) isAbstract = true;

    const iconMatch = line.match(/^@icon\s*\(\s*"([^"]+)"\s*\)/);
    if (iconMatch) {
      icon = iconMatch[1];
    }

    const classMatch = line.match(
      /^(?:@abstract\s+)?class_name\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+extends\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_.]*)))?/,
    );
    if (classMatch) {
      className = classMatch[1];
      if (classMatch[3] || classMatch[4]) {
        baseName = classMatch[3] || classMatch[4];
      }
      continue;
    }

    const extendsMatch = line.match(
      /^extends\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_.]*))/,
    );
    if (extendsMatch) {
      baseName = extendsMatch[2] || extendsMatch[3];
    }
  }

  if (!className) return null;

  return {
    base: baseName,
    class: className,
    icon,
    is_abstract: isAbstract,
    is_tool: isTool,
    language: "GDScript",
    path: `res://${relPath}`,
  };
}

function buildGlobalScriptClassCache(projectFiles) {
  const entries = [];
  for (const [relPath, content] of Object.entries(projectFiles)) {
    if (!relPath.toLowerCase().endsWith(".gd")) continue;
    if (relPath.startsWith("addons/scad_importer/")) continue;
    const info = parseGdScriptClassInfo(relPath, content);
    if (info) entries.push(info);
  }

  if (entries.length === 0) return "list=[]\n";

  entries.sort((a, b) => a.class.localeCompare(b.class));

  const formattedEntries = entries.map(
    (entry) =>
      `{\n` +
      `"base": &"${escapeGdConfigString(entry.base)}",\n` +
      `"class": &"${escapeGdConfigString(entry.class)}",\n` +
      `"icon": "${escapeGdConfigString(entry.icon)}",\n` +
      `"is_abstract": ${entry.is_abstract},\n` +
      `"is_tool": ${entry.is_tool},\n` +
      `"language": &"${escapeGdConfigString(entry.language)}",\n` +
      `"path": "${escapeGdConfigString(entry.path)}"\n` +
      `}`,
  );

  return `list=[${formattedEntries.join(", ")}]\n`;
}

/**
 * Compiles all .scad assets in the Godot project to .glb via OpenSCAD WASM,
 * injects the runtime SCAD loader, and builds an in-memory .pck buffer.
 */
export async function compileGodotProjectToPck(project, options = {}) {
  const { wasmUrl, onProgress, scadCache = new Map() } = options;
  const pckFiles = new Map();
  const logs = [];

  const scadPaths = Object.keys(project.files).filter((p) => isScadFilePath(p));
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

  if (!project.files[GLOBAL_SCRIPT_CLASS_CACHE_PATH]) {
    const classCache = buildGlobalScriptClassCache(project.files);
    if (classCache) {
      pckFiles.set(`res://${GLOBAL_SCRIPT_CLASS_CACHE_PATH}`, classCache);
    }
  }

  if (onProgress) {
    onProgress("Packing Godot project (.pck)...");
  }

  const pckBuffer = buildGodotPck(pckFiles);
  return { pckBuffer, logs, compiledCount };
}

function sanitizeProjectName(name, fallback) {
  return (
    String(name || "")
      .replace(/[^A-Za-z0-9_.-]+/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "") || fallback
  );
}

function generateProjectZipBlob(zip, onProgress) {
  if (onProgress) onProgress("Creating ZIP archive...");
  return zip.generateAsync(
    {
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    },
    (metadata) => {
      if (onProgress) {
        onProgress(
          `Creating ZIP archive (${Math.round(metadata.percent)}%)...`,
        );
      }
    },
  );
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchGodotRuntimeAsset(url, kind) {
  const res = await fetch(url);
  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) return null;

  if (kind === "wasm") {
    if (
      bytes.byteLength < 4 ||
      bytes[0] !== 0x00 ||
      bytes[1] !== 0x61 ||
      bytes[2] !== 0x73 ||
      bytes[3] !== 0x6d
    ) {
      return null;
    }
  } else if (kind === "js") {
    const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
    if (head.startsWith("<")) return null;
  }

  return bytes;
}

async function fetchGodotWebRuntimeFiles(godotBaseUrl) {
  const normalizedBase = godotBaseUrl.replace(/\/+$/, "");
  const lastSlash = normalizedBase.lastIndexOf("/");
  const baseDir =
    lastSlash === -1 ? "" : normalizedBase.slice(0, lastSlash + 1);
  const baseName =
    lastSlash === -1 ? normalizedBase : normalizedBase.slice(lastSlash + 1);

  const requiredAssets = [
    { name: `${baseName}.js`, kind: "js" },
    { name: `${baseName}.wasm`, kind: "wasm" },
  ];

  const optionalAssets = [
    { name: `${baseName}.audio.worklet.js`, kind: "js" },
    { name: `${baseName}.audio.position.worklet.js`, kind: "js" },
    { name: `${baseName}.worker.js`, kind: "js" },
    { name: `${baseName}.side.wasm`, kind: "wasm" },
  ];

  const fetched = [];
  for (const asset of requiredAssets) {
    const data = await fetchGodotRuntimeAsset(
      `${baseDir}${asset.name}`,
      asset.kind,
    );
    if (!data) {
      throw new Error(
        `Missing Godot Web runtime file "${baseDir}${asset.name}". Make sure Godot Web templates are available.`,
      );
    }
    fetched.push({ name: asset.name, data });
  }

  for (const asset of optionalAssets) {
    const data = await fetchGodotRuntimeAsset(
      `${baseDir}${asset.name}`,
      asset.kind,
    );
    if (data) {
      fetched.push({ name: asset.name, data });
    }
  }

  return { baseName, files: fetched };
}

function buildGodotWebIndexHtml({
  title,
  executable,
  mainPack,
  fileSizes,
  threads,
}) {
  const safeJson = (val) => JSON.stringify(val).replace(/<\//g, "<\\/");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, user-scalable=no, initial-scale=1.0"
    />
    <title>${escapeHtml(title)}</title>
    <style>
      html,
      body,
      #canvas {
        margin: 0;
        padding: 0;
        border: 0;
      }
      body {
        color: #ffffff;
        background-color: #000000;
        overflow: hidden;
        touch-action: none;
        font-family: system-ui, sans-serif;
      }
      #canvas {
        display: block;
      }
      #canvas:focus {
        outline: none;
      }
      #status {
        position: absolute;
        inset: 0;
        background-color: #1a1a1a;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 14px;
        visibility: hidden;
      }
      #status-progress {
        width: min(360px, 80vw);
        height: 8px;
        background-color: #333333;
        border-radius: 4px;
        overflow: hidden;
      }
      #status-progress-inner {
        height: 100%;
        width: 0%;
        background-color: #478cbf;
        transition: width 0.1s linear;
      }
      #status-notice {
        max-width: 80vw;
        text-align: center;
        font-size: 14px;
        line-height: 1.4;
        color: #ff6b6b;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <canvas id="canvas">
      Your browser does not support the canvas tag.
    </canvas>
    <noscript>Your browser does not support JavaScript.</noscript>
    <div id="status">
      <div id="status-title">Loading ${escapeHtml(title)}...</div>
      <div id="status-progress">
        <div id="status-progress-inner"></div>
      </div>
      <div id="status-notice"></div>
    </div>
    <script src="${escapeHtml(executable)}.js"></script>
    <script>
      const GODOT_CONFIG = {
        args: [],
        canvasResizePolicy: 2,
        emscriptenPoolSize: 8,
        ensureCrossOriginIsolationHeaders: false,
        executable: ${safeJson(executable)},
        experimentalVK: false,
        fileSizes: ${safeJson(fileSizes)},
        focusCanvas: true,
        gdextensionLibs: [],
        godotPoolSize: 4,
        mainPack: ${safeJson(mainPack)},
      };
      const engine = new Engine(GODOT_CONFIG);
      (function () {
        const statusOverlay = document.getElementById("status");
        const statusProgress = document.getElementById("status-progress");
        const statusProgressInner = document.getElementById(
          "status-progress-inner",
        );
        const statusNotice = document.getElementById("status-notice");

        let initializing = true;
        function setStatusMode(mode) {
          if (!initializing) return;
          if (mode === "hidden") {
            statusOverlay.style.visibility = "hidden";
            initializing = false;
            return;
          }
          statusOverlay.style.visibility = "visible";
          statusProgress.style.display = mode === "progress" ? "block" : "none";
          statusNotice.style.display = mode === "notice" ? "block" : "none";
        }
        function setStatusNotice(text) {
          statusNotice.textContent = text;
        }
        function displayFailureNotice(err) {
          console.error(err);
          if (err instanceof Error) {
            setStatusNotice(err.message);
          } else if (typeof err === "string") {
            setStatusNotice(err);
          } else {
            setStatusNotice("An unknown error occurred.");
          }
          setStatusMode("notice");
          initializing = false;
        }

        const missing =
          typeof Engine.getMissingFeatures === "function"
            ? Engine.getMissingFeatures({ threads: ${safeJson(Boolean(threads))} })
            : [];
        if (missing.length !== 0) {
          displayFailureNotice(
            "Error\\nThe following features required to run Godot projects on the Web are missing:\\n" +
              missing.join("\\n"),
          );
        } else {
          setStatusMode("progress");
          engine
            .startGame({
              canvas: document.getElementById("canvas"),
              onProgress: function (current, total) {
                if (current > 0 && total > 0) {
                  statusProgressInner.style.width =
                    Math.min(100, (current / total) * 100) + "%";
                }
              },
            })
            .then(function () {
              setStatusMode("hidden");
            }, displayFailureNotice);
        }
      })();
    </script>
  </body>
</html>
`;
}

/**
 * Compiles the Godot Markdown project and packages a standalone,
 * ready-to-deploy Web export (.zip containing <rootFolder>/index.html, .pck, and runtime files).
 */
export async function exportGodotProjectWebZip(project, options = {}) {
  const {
    wasmUrl,
    godotBaseUrl = "./godot/godot",
    folderName,
    scadCache = new Map(),
    onProgress,
  } = options;

  const { pckBuffer, logs, compiledCount } = await compileGodotProjectToPck(
    project,
    { wasmUrl, scadCache, onProgress },
  );

  if (onProgress) onProgress("Fetching Godot Web runtime...");
  const { baseName, files: runtimeFiles } =
    await fetchGodotWebRuntimeFiles(godotBaseUrl);

  const safeProjectName = sanitizeProjectName(
    project.projectName,
    "godot_project",
  );
  const rootFolderName = sanitizeProjectName(folderName, safeProjectName);
  const pckFileName = `${safeProjectName}.pck`;

  const displayTitle =
    (folderName && String(folderName).trim()) || rootFolderName;

  const fileSizes = {
    [pckFileName]: pckBuffer.byteLength,
  };
  const wasmFile = runtimeFiles.find(
    (f) => f.name.endsWith(".wasm") && !f.name.includes(".side."),
  );
  if (wasmFile) {
    fileSizes[wasmFile.name] = wasmFile.data.byteLength;
  }
  const hasWorker = runtimeFiles.some((f) => f.name.endsWith(".worker.js"));

  const indexHtml = buildGodotWebIndexHtml({
    title: displayTitle,
    executable: baseName,
    mainPack: pckFileName,
    fileSizes,
    threads: hasWorker,
  });

  const zip = new JSZip();
  const rootFolder = zip.folder(rootFolderName);
  rootFolder.file("index.html", indexHtml);
  rootFolder.file(pckFileName, pckBuffer);
  for (const file of runtimeFiles) {
    rootFolder.file(file.name, file.data);
  }

  const zipBlob = await generateProjectZipBlob(zip, onProgress);
  return { zipBlob, pckFileName, rootFolderName, compiledCount, logs };
}

/**
 * Packages the raw Godot Markdown project files (including SCAD importer addon
 * files if referenced and missing) into a downloadable .zip archive.
 */
export async function exportGodotProjectZip(project, options = {}) {
  const { folderName, onProgress } = options;

  if (!project || !project.files) {
    throw new Error("Invalid Godot project.");
  }

  const safeProjectName = sanitizeProjectName(
    project.projectName,
    "godot_project",
  );
  const rootFolderName = sanitizeProjectName(folderName, safeProjectName);

  const filesToPack = { ...project.files };
  const needsScadAddon =
    Object.keys(filesToPack).some((p) => isScadFilePath(p)) ||
    /scad_importer/.test(filesToPack["project.godot"] || "");

  if (needsScadAddon) {
    for (const addonFile of GODOT_ADDON_FILES) {
      if (filesToPack[addonFile.path] === undefined) {
        filesToPack[addonFile.path] = addonFile.content;
      }
    }
  }

  const zip = new JSZip();
  const rootFolder = zip.folder(rootFolderName);

  const sortedPaths = Object.keys(filesToPack).sort((a, b) =>
    a.localeCompare(b),
  );
  for (const relPath of sortedPaths) {
    const cleanRel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!cleanRel) continue;
    rootFolder.file(cleanRel, filesToPack[relPath]);
  }

  const zipBlob = await generateProjectZipBlob(zip, onProgress);

  return { zipBlob, rootFolderName, fileCount: sortedPaths.length };
}
