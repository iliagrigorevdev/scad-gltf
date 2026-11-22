import { convertScadToGltf } from "scad-gltf/convert";
import {
  extractFilesFromMarkdown,
  extractScadDependencies,
  isScadFilePath,
} from "scad-gltf/utils";
import { extractRootFolderFromMarkdownFiles } from "./md-utils.js";
import { exportGodotProjectZip } from "./godot-project.js";
import { RUST_TEMPLATE_FILES, UE_PLUGIN_FILES } from "./prompt-ui.js";
import JSZip from "jszip";

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

function sanitizeProjectName(name, fallback) {
  return (
    String(name || "")
      .replace(/[^A-Za-z0-9_.-]+/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "") || fallback
  );
}

function findShortestMarkerPath(paths, predicate) {
  return paths
    .map((p) => ({ orig: p, norm: p.replace(/\\/g, "/").replace(/^\/+/, "") }))
    .filter(({ norm }) => predicate(norm))
    .sort((a, b) => a.norm.length - b.norm.length)[0];
}

function extractRustCargoName(cargoToml) {
  if (typeof cargoToml !== "string") return null;
  const pkgSection = cargoToml.match(/\[package\][\s\S]*?(?=\n\[|$)/);
  const scope = pkgSection ? pkgSection[0] : cargoToml;
  const match = scope.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return match ? match[1].trim() : null;
}

function extractPackageJsonName(pkgJson) {
  if (typeof pkgJson !== "string") return null;
  try {
    const parsed = JSON.parse(pkgJson);
    if (typeof parsed?.name === "string" && parsed.name.trim()) {
      return parsed.name.trim();
    }
  } catch {
    // ignore invalid JSON
  }
  return null;
}

/**
 * Detects whether a markdown string contains a project with ### filepath blocks
 * (Godot, UE, Rust, Web, or generic multi-file/SCAD project).
 * Returns normalized relative project files if found, otherwise null.
 */
export function parseMarkdownProject(mdContent) {
  if (typeof mdContent !== "string" || !mdContent.includes("###")) {
    return null;
  }

  const rawFiles = extractFilesFromMarkdown(mdContent);
  const paths = Object.keys(rawFiles);
  if (paths.length === 0) return null;

  let projectType = "generic";
  let rootPrefix = "";
  let projectName = null;

  const godotMarker = findShortestMarkerPath(
    paths,
    (norm) => norm === "project.godot" || norm.endsWith("/project.godot"),
  );
  const ueMarker = !godotMarker
    ? findShortestMarkerPath(paths, (norm) =>
        norm.toLowerCase().endsWith(".uproject"),
      )
    : null;
  const rustMarker =
    !godotMarker && !ueMarker
      ? findShortestMarkerPath(
          paths,
          (norm) => norm === "Cargo.toml" || norm.endsWith("/Cargo.toml"),
        )
      : null;
  const webMarker =
    !godotMarker && !ueMarker && !rustMarker
      ? findShortestMarkerPath(
          paths,
          (norm) => norm === "package.json" || norm.endsWith("/package.json"),
        )
      : null;

  if (godotMarker) {
    projectType = "godot";
    rootPrefix =
      godotMarker.norm === "project.godot"
        ? ""
        : godotMarker.norm.slice(0, -"project.godot".length);
    projectName = rootPrefix
      ? rootPrefix.replace(/\/$/, "").split("/").pop()
      : "godot_project";
  } else if (ueMarker) {
    projectType = "ue";
    const lastSlash = ueMarker.norm.lastIndexOf("/");
    rootPrefix = lastSlash === -1 ? "" : ueMarker.norm.slice(0, lastSlash + 1);
    const uprojectFile =
      lastSlash === -1 ? ueMarker.norm : ueMarker.norm.slice(lastSlash + 1);
    projectName =
      (rootPrefix ? rootPrefix.replace(/\/$/, "").split("/").pop() : "") ||
      uprojectFile.replace(/\.uproject$/i, "") ||
      "ue_project";
  } else if (rustMarker) {
    projectType = "rust";
    rootPrefix =
      rustMarker.norm === "Cargo.toml"
        ? ""
        : rustMarker.norm.slice(0, -"Cargo.toml".length);
    projectName =
      (rootPrefix ? rootPrefix.replace(/\/$/, "").split("/").pop() : "") ||
      extractRustCargoName(rawFiles[rustMarker.orig]) ||
      "rust_project";
  } else if (webMarker) {
    projectType = "web";
    rootPrefix =
      webMarker.norm === "package.json"
        ? ""
        : webMarker.norm.slice(0, -"package.json".length);
    projectName =
      (rootPrefix ? rootPrefix.replace(/\/$/, "").split("/").pop() : "") ||
      extractPackageJsonName(rawFiles[webMarker.orig]) ||
      "web_project";
  } else {
    const commonRoot = extractRootFolderFromMarkdownFiles(rawFiles);
    if (commonRoot) {
      rootPrefix = `${commonRoot}/`;
      projectName = commonRoot;
    } else {
      projectName = "project";
    }
  }

  const files = {};
  for (const [origPath, content] of Object.entries(rawFiles)) {
    const norm = origPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (rootPrefix && !norm.startsWith(rootPrefix)) continue;
    const relPath = rootPrefix ? norm.slice(rootPrefix.length) : norm;
    if (!relPath) continue;
    files[relPath] = content;
  }

  if (Object.keys(files).length === 0) return null;

  return {
    projectType,
    isGodotProject: projectType === "godot",
    projectName,
    rootPrefix,
    files,
  };
}

function resolveScadDepsForFile(entryRelPath, projectFiles) {
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
    if (typeof content !== "string") continue;
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

async function compileProjectScadFiles(project, options = {}) {
  const { wasmUrl, onProgress, scadCache = new Map() } = options;
  const compiledGlbs = new Map();
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
    const additionalFiles = resolveScadDepsForFile(scadPath, project.files);
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

    compiledGlbs.set(scadPath, glbData);
    compiledCount++;
  }

  return { compiledGlbs, logs, compiledCount };
}

function injectFallbackAddons(projectType, filesToPack) {
  const hasScadFiles = Object.keys(filesToPack).some((p) => isScadFilePath(p));

  if (projectType === "ue") {
    const hasUeScadPluginRef = Object.entries(filesToPack).some(
      ([p, content]) =>
        p.toLowerCase().endsWith(".uproject") &&
        /ScadImporter/.test(String(content || "")),
    );
    if (hasScadFiles || hasUeScadPluginRef) {
      for (const pluginFile of UE_PLUGIN_FILES) {
        const existing = filesToPack[pluginFile.path];
        if (existing === undefined) {
          filesToPack[pluginFile.path] = pluginFile.content;
        } else if (
          pluginFile.path.endsWith("/ScadImportFactory.cpp") &&
          !String(existing).includes("__scad_glbs") &&
          String(existing).includes("UScadImportFactory::FactoryCreateFile")
        ) {
          filesToPack[pluginFile.path] = pluginFile.content;
        }
      }
    }
  } else if (projectType === "rust") {
    if (hasScadFiles || filesToPack["Cargo.toml"] !== undefined) {
      for (const tplFile of RUST_TEMPLATE_FILES) {
        const existing = filesToPack[tplFile.path];
        if (existing === undefined) {
          filesToPack[tplFile.path] = tplFile.content;
        } else if (
          tplFile.path === "build.rs" &&
          !String(existing).includes("__scad_glbs") &&
          String(existing).includes("scad-gltf") &&
          String(existing).includes("./assets/models")
        ) {
          filesToPack[tplFile.path] = tplFile.content;
        }
      }
    }
  }
}

/**
 * Packages any Markdown project (Godot, Unreal Engine, Rust, Web, or generic)
 * along with its addons/scripts and precompiled cached .glb models for fallback
 * into a downloadable .zip archive.
 */
export async function exportProjectZip(project, options = {}) {
  if (!project || !project.files) {
    throw new Error("Invalid project.");
  }

  if (project.projectType === "godot" || project.isGodotProject) {
    return exportGodotProjectZip(project, options);
  }

  const { wasmUrl, folderName, scadCache = new Map(), onProgress } = options;

  const safeProjectName = sanitizeProjectName(project.projectName, "project");
  const rootFolderName = sanitizeProjectName(folderName, safeProjectName);

  const filesToPack = { ...project.files };
  injectFallbackAddons(project.projectType, filesToPack);

  const { compiledGlbs, compiledCount } = await compileProjectScadFiles(
    project,
    {
      wasmUrl,
      scadCache,
      onProgress,
    },
  );

  if (compiledGlbs.size > 0) {
    for (const [scadPath, glbData] of compiledGlbs.entries()) {
      const cleanScadPath = scadPath.replace(/\\/g, "/").replace(/^\/+/, "");
      filesToPack[`__scad_glbs/${cleanScadPath}.glb`] = glbData;
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

  if (onProgress) onProgress("Creating ZIP archive...");
  const zipBlob = await zip.generateAsync(
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

  return {
    zipBlob,
    rootFolderName,
    fileCount: sortedPaths.length,
    compiledCount,
  };
}
