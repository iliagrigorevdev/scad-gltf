#!/usr/bin/env node
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import os from "os";
import { execSync, spawn } from "child_process";
import { convertScadToGltf } from "../src/convert.js";
import { installWasmFetchPolyfill } from "../src/process-utils.js";
import { getUePaths } from "../src/ue-utils.js";
import { getGodotBin } from "../src/godot-utils.js";
import {
  extractFilesFromMarkdown,
  extractScadDependencies,
  isScadFilePath,
} from "../src/utils.js";
import { writeExtractedFiles } from "../src/cli-utils.js";

// Resolve the local paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../ext/openscad.wasm");
const editorDir = path.resolve(__dirname, "../editor");
const editorDistDir = path.join(editorDir, "dist");

installWasmFetchPolyfill();

// Parse CLI arguments
const args = process.argv.slice(2);
let port = 3000;
let ueRootArg = "";
let godotBinArg = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") {
    port = parseInt(args[i + 1]) || 3000;
    i++; // Skip the port number value
  } else if (args[i] === "--ue-root") {
    ueRootArg = args[i + 1] || "";
    i++;
  } else if (args[i] === "--godot-bin") {
    godotBinArg = args[i + 1] || "";
    i++;
  }
}

if (godotBinArg) {
  const resolvedGodot = path.resolve(
    godotBinArg.trim().replace(/^["']|["']$/g, ""),
  );
  if (!fs.existsSync(resolvedGodot)) {
    console.error(`❌ Invalid GODOT_BIN: file not found at ${resolvedGodot}`);
    process.exit(1);
  }
  process.env.GODOT_BIN = resolvedGodot;
}

if (ueRootArg) {
  process.env.UE_ROOT = path.resolve(
    ueRootArg.trim().replace(/^["']|["']$/g, ""),
  );
  try {
    getUePaths();
  } catch (err) {
    console.error(`❌ Invalid UE_ROOT: ${err.message}`);
    process.exit(1);
  }
}

// Target directory is the current working directory where the script is run
const workDir = process.cwd();

// ========================
// Editor Build Step (Only if dist is missing)
// ========================
if (!fs.existsSync(editorDistDir) && fs.existsSync(editorDir)) {
  console.log("⚙️  Editor build missing. Attempting to build...");
  try {
    if (!fs.existsSync(path.join(editorDir, "node_modules"))) {
      console.log("📦 Installing editor dependencies...");
      execSync("npm install", { cwd: editorDir, stdio: "inherit" });
    }

    console.log("🛠️  Building editor...");
    execSync("npm run build", { cwd: editorDir, stdio: "inherit" });
    console.log("✅ Editor built successfully.\n");
  } catch (err) {
    console.error("❌ Error building editor:", err.message);
    console.log("⚠️  Continuing without an editor build...\n");
  }
}

const app = express();
// Increase payload limit in case of very large SCAD files
app.use(express.json({ limit: "50mb" }));

// Basic CORS middleware for external web clients
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, PUT, POST, PATCH, DELETE, OPTIONS",
  );
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Helper: Sanitize filename to prevent directory traversal attacks
function sanitizeFilename(filename) {
  const safeName = path.basename(filename);
  if (safeName.endsWith(".scad") || safeName.endsWith(".md")) {
    return safeName;
  }
  return safeName.endsWith(".scad") ? safeName : `${safeName}.scad`;
}

// ========================
// File Management API
// ========================

// 1. List all .scad and .md files in the current directory
app.get("/api/scads", (req, res) => {
  try {
    const files = fs
      .readdirSync(workDir)
      .filter(
        (file) =>
          (file.toLowerCase().endsWith(".scad") ||
            file.toLowerCase().endsWith(".md")) &&
          fs.statSync(path.join(workDir, file)).isFile(),
      );

    res.json({ files });
  } catch (err) {
    console.error("Error reading directory:", err);
    res.status(500).json({ error: "Failed to list files." });
  }
});

// 2. Read specific .scad or .md file content
app.get("/api/scads/:filename", (req, res) => {
  const filename = sanitizeFilename(req.params.filename);
  const filePath = path.join(workDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File '${filename}' not found.` });
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ filename, content });
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    res.status(500).json({ error: "Failed to read file." });
  }
});

// 3. Create or Update a .scad or .md file
app.post("/api/scads", (req, res) => {
  const { filename: rawFilename, content } = req.body;

  if (!rawFilename) {
    return res
      .status(400)
      .json({ error: "Missing 'filename' in request body." });
  }

  const filename = sanitizeFilename(rawFilename);
  const filePath = path.join(workDir, filename);
  const isUpdate = fs.existsSync(filePath);

  try {
    fs.writeFileSync(filePath, content || "", "utf-8");
    res.json({
      message: isUpdate
        ? "File updated successfully"
        : "File created successfully",
      filename,
    });
  } catch (err) {
    console.error(`Error writing to ${filename}:`, err);
    res.status(500).json({ error: "Failed to write file." });
  }
});

// 4. Delete a .scad or .md file
app.delete("/api/scads/:filename", (req, res) => {
  const filename = sanitizeFilename(req.params.filename);
  const filePath = path.join(workDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File '${filename}' not found.` });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ message: "File deleted successfully", filename });
  } catch (err) {
    console.error(`Error deleting ${filename}:`, err);
    res.status(500).json({ error: "Failed to delete file." });
  }
});

// 5. Convert SCAD to GLB
app.post("/api/convert", async (req, res) => {
  const { content, options } = req.body;

  const additionalFiles = (options && options.additionalFiles) || {};

  if (!content) {
    return res
      .status(400)
      .json({ error: "Missing 'content' in request body." });
  }

  try {
    // Pass the raw SCAD directly to the WASM converter entirely in-memory
    const glbData = await convertScadToGltf(content, {
      wasmUrl: pathToFileURL(wasmPath).href,
      additionalFiles,
      variables: (options && options.variables) || undefined,
    });

    res.setHeader("Content-Type", "model/gltf-binary");
    res.send(Buffer.from(glbData));
  } catch (err) {
    console.error("SCAD Conversion Error:", err);
    res
      .status(500)
      .json({ error: "Failed to convert SCAD to GLB: " + err.toString() });
  }
});

// ========================
// Native Project Runner API (UE, Rust, Godot)
// ========================
const RUNNER_TYPES = ["ue", "rust", "godot"];

function createRunState() {
  return {
    runId: 0,
    status: "idle", // "idle" | "building" | "running" | "stopped" | "error"
    projectName: null,
    projectDir: null,
    exitCode: null,
    error: null,
    logs: "",
    logBaseOffset: 0,
    process: null,
    tempDir: null,
  };
}

const runnerStates = {
  ue: createRunState(),
  rust: createRunState(),
  godot: createRunState(),
};

function appendRunnerLog(state, text) {
  if (!text) return;
  state.logs += text;
  const maxChars = 500000;
  if (state.logs.length > maxChars) {
    const drop = state.logs.length - maxChars;
    state.logs = state.logs.slice(drop);
    state.logBaseOffset += drop;
  }
}

function killChildProcessTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-proc.pid, "SIGTERM");
    }
  } catch {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
}

function cleanupDirSafe(dirPath) {
  if (!dirPath) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function stopActiveRun(runnerType, markStopped = true) {
  const state = runnerStates[runnerType];
  if (!state) return;
  state.runId += 1;
  const proc = state.process;
  const tempDir = state.tempDir;
  state.process = null;
  state.tempDir = null;

  if (proc) {
    killChildProcessTree(proc);
  }
  if (tempDir) {
    cleanupDirSafe(tempDir);
  }
  if (
    markStopped &&
    (state.status === "building" || state.status === "running")
  ) {
    state.status = "stopped";
    appendRunnerLog(state, "\n⏹ Stopped by user.\n");
  }
}

function stopAllActiveRuns() {
  for (const rType of RUNNER_TYPES) {
    stopActiveRun(rType, false);
  }
}

function extractCargoPackageName(cargoTomlPath) {
  try {
    const content = fs.readFileSync(cargoTomlPath, "utf8");
    const pkgSection = content.match(/\[package\][\s\S]*?(?=\n\[|$)/);
    const scope = pkgSection ? pkgSection[0] : content;
    const match = scope.match(/^\s*name\s*=\s*"([^"]+)"/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function extractGodotProjectName(projectGodotPath) {
  try {
    const content = fs.readFileSync(projectGodotPath, "utf8");
    const match = content.match(/^\s*config\/name\s*=\s*"([^"]+)"/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function findProjectInTempDir(tempDir, runnerType) {
  const candidates = [tempDir];
  for (const entry of fs.readdirSync(tempDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      candidates.push(path.join(tempDir, entry.name));
    }
  }
  for (const dir of candidates) {
    const entries = fs.readdirSync(dir);
    if (runnerType === "ue") {
      const uproject = entries.find((f) =>
        f.toLowerCase().endsWith(".uproject"),
      );
      if (uproject) {
        return {
          projectDir: dir,
          markerFile: uproject,
          projectName: path.basename(uproject, ".uproject"),
        };
      }
    } else if (runnerType === "rust") {
      const cargo = entries.find((f) => f === "Cargo.toml");
      if (cargo) {
        const cargoPath = path.join(dir, cargo);
        const dirName = dir !== tempDir ? path.basename(dir) : "";
        return {
          projectDir: dir,
          markerFile: cargo,
          projectName:
            dirName || extractCargoPackageName(cargoPath) || "rust_project",
        };
      }
    } else if (runnerType === "godot") {
      const godotFile = entries.find((f) => f === "project.godot");
      if (godotFile) {
        const godotPath = path.join(dir, godotFile);
        const dirName = dir !== tempDir ? path.basename(dir) : "";
        return {
          projectDir: dir,
          markerFile: godotFile,
          projectName:
            dirName || extractGodotProjectName(godotPath) || "godot_project",
        };
      }
    }
  }
  return null;
}

function hasProjectScadFiles(projectDir, ignoreDirs = []) {
  const ignoreSet = new Set(["__scad_glbs", ".git", ...ignoreDirs]);
  let found = false;
  function walk(dir) {
    if (found || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoreSet.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (isScadFilePath(entry.name)) {
        found = true;
        return;
      }
    }
  }
  walk(projectDir);
  return found;
}

function injectUeScadPluginFallback(projectDir, uprojectPath) {
  const ueDir = path.resolve(__dirname, "../ue");
  const pluginTemplateDir = path.join(ueDir, "Plugins", "ScadImporter");
  if (!fs.existsSync(pluginTemplateDir)) return;

  const uprojectContent = fs.readFileSync(uprojectPath, "utf8");
  const hasScadPluginRef = /ScadImporter/.test(uprojectContent);
  const hasScadFiles = hasProjectScadFiles(projectDir, [
    "Plugins",
    "Binaries",
    "Intermediate",
    "Saved",
  ]);

  if (!hasScadFiles && !hasScadPluginRef) return;

  function copyTemplates(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        copyTemplates(fullPath);
      } else if (/\.(uplugin|cs|cpp|h)$/i.test(entry.name)) {
        const relPath = path.relative(ueDir, fullPath);
        const destPath = path.join(projectDir, relPath);
        const tplContent = fs.readFileSync(fullPath, "utf8");

        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, tplContent, "utf8");
        } else if (
          entry.name === "ScadImportFactory.cpp" &&
          !fs.readFileSync(destPath, "utf8").includes("__scad_glbs")
        ) {
          fs.writeFileSync(destPath, tplContent, "utf8");
        }
      }
    }
  }
  copyTemplates(pluginTemplateDir);
}

function injectRustBuildFallback(projectDir) {
  const rustDir = path.resolve(__dirname, "../rust");
  const buildRsSrc = path.join(rustDir, "build.rs");
  if (!fs.existsSync(buildRsSrc)) return;

  const hasCargoToml = fs.existsSync(path.join(projectDir, "Cargo.toml"));
  const hasScadFiles = hasProjectScadFiles(projectDir, ["target"]);
  if (!hasScadFiles && !hasCargoToml) return;

  const destPath = path.join(projectDir, "build.rs");
  const tplContent = fs.readFileSync(buildRsSrc, "utf8");

  if (!fs.existsSync(destPath)) {
    fs.writeFileSync(destPath, tplContent, "utf8");
  } else {
    const existing = fs.readFileSync(destPath, "utf8");
    if (
      !existing.includes("__scad_glbs") &&
      existing.includes("scad-gltf") &&
      existing.includes("./assets/models")
    ) {
      fs.writeFileSync(destPath, tplContent, "utf8");
    }
  }
}

function injectGodotAddonFallback(projectDir, projectGodotPath) {
  const godotDir = path.resolve(__dirname, "../godot");
  const addonDir = path.join(godotDir, "addons", "scad_importer");
  if (!fs.existsSync(addonDir)) return;

  const projectGodotContent = fs.readFileSync(projectGodotPath, "utf8");
  const hasScadPluginRef = /scad_importer/.test(projectGodotContent);
  const hasScadFiles = hasProjectScadFiles(projectDir, [
    "addons",
    ".godot",
    ".import",
  ]);
  if (!hasScadFiles && !hasScadPluginRef) return;

  const destAddonDir = path.join(projectDir, "addons", "scad_importer");
  for (const entry of fs.readdirSync(addonDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(gd|cfg)$/i.test(entry.name)) continue;
    const srcPath = path.join(addonDir, entry.name);
    const destPath = path.join(destAddonDir, entry.name);
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destAddonDir, { recursive: true });
      fs.writeFileSync(destPath, fs.readFileSync(srcPath, "utf8"), "utf8");
    }
  }
}

async function precompileProjectScadFiles(projectDir, state, options = {}) {
  const { ignoreDirs = [], writeGdIgnore = false } = options;
  const ignoreSet = new Set(["__scad_glbs", ".git", ...ignoreDirs]);
  const scadPaths = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreSet.has(entry.name)) continue;
        walk(fullPath);
      } else if (isScadFilePath(entry.name)) {
        scadPaths.push(fullPath);
      }
    }
  }
  walk(projectDir);

  if (scadPaths.length === 0) return 0;

  let compiledCount = 0;
  const wasmUrl = pathToFileURL(wasmPath).href;

  function collectDeps(absFile, baseDir, additionalFiles, visited) {
    if (visited.has(absFile) || !fs.existsSync(absFile)) return;
    visited.add(absFile);
    const code = fs.readFileSync(absFile, "utf8");
    for (const rawDep of extractScadDependencies(code)) {
      const depAbs = path.resolve(path.dirname(absFile), rawDep);
      if (!fs.existsSync(depAbs)) continue;
      const vfsKey = path.relative(baseDir, depAbs).replace(/\\/g, "/");
      additionalFiles[vfsKey] = fs.readFileSync(depAbs, "utf8");
      collectDeps(depAbs, baseDir, additionalFiles, visited);
    }
  }

  for (const absScad of scadPaths) {
    const relPosix = path.relative(projectDir, absScad).replace(/\\/g, "/");
    const scadCode = fs.readFileSync(absScad, "utf8");
    const additionalFiles = {};
    collectDeps(
      absScad,
      path.dirname(absScad),
      additionalFiles,
      new Set([absScad]),
    );

    try {
      const glbData = await convertScadToGltf(scadCode, {
        wasmUrl,
        additionalFiles,
      });
      const outPath = path.join(projectDir, "__scad_glbs", `${relPosix}.glb`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, glbData);
      compiledCount++;
    } catch (err) {
      const msg = err?.message || String(err);
      if (/empty/i.test(msg)) {
        appendRunnerLog(
          state,
          `[SCAD] Skipped helper library ${relPosix} (no top-level geometry).\n`,
        );
      } else {
        appendRunnerLog(
          state,
          `[SCAD] Warning: failed precompiling ${relPosix}: ${msg}\n`,
        );
      }
    }
  }

  if (writeGdIgnore && compiledCount > 0) {
    const gdIgnorePath = path.join(projectDir, "__scad_glbs", ".gdignore");
    fs.mkdirSync(path.dirname(gdIgnorePath), { recursive: true });
    fs.writeFileSync(gdIgnorePath, "");
  }

  return compiledCount;
}

function spawnRunnerCommand(command, args, cwd, extraEnv = null) {
  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  const isWinBat =
    process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command);
  if (isWinBat) {
    const quotedCmd = [`"${command}"`, ...args.map((a) => `"${a}"`)].join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", quotedCmd], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

function handleRunnerStatus(runnerType, req, res) {
  const state = runnerStates[runnerType];
  const since = Math.max(0, parseInt(req.query.since, 10) || 0);
  const totalOffset = state.logBaseOffset + state.logs.length;
  const startIdx = Math.max(0, since - state.logBaseOffset);
  const chunk = state.logs.slice(startIdx);

  res.json({
    projectType: runnerType,
    runId: state.runId,
    status: state.status,
    running: state.status === "building" || state.status === "running",
    projectName: state.projectName,
    ueConfigured: Boolean(process.env.UE_ROOT),
    exitCode: state.exitCode,
    error: state.error,
    logs: chunk,
    nextOffset: totalOffset,
  });
}

function handleRunnerStop(runnerType, _req, res) {
  stopActiveRun(runnerType, true);
  res.json({
    ok: true,
    projectType: runnerType,
    status: runnerStates[runnerType].status,
  });
}

async function handleRunnerRun(runnerType, req, res) {
  const state = runnerStates[runnerType];
  const { markdown } = req.body || {};
  if (!markdown || typeof markdown !== "string") {
    return res
      .status(400)
      .json({ error: "Missing 'markdown' project content." });
  }

  let uePaths = null;
  if (runnerType === "ue") {
    try {
      uePaths = getUePaths();
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const files = extractFilesFromMarkdown(markdown);
  if (Object.keys(files).length === 0) {
    return res.status(400).json({
      error:
        "No files could be extracted from Markdown. Ensure '### filepath' headers and code blocks are used.",
    });
  }

  stopActiveRun(runnerType, false);
  const thisRunId = ++state.runId;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `scad-${runnerType}-run-`),
  );

  try {
    writeExtractedFiles(files, tempDir);
    const detected = findProjectInTempDir(tempDir, runnerType);
    if (!detected) {
      cleanupDirSafe(tempDir);
      const expectedHint =
        runnerType === "ue"
          ? ".uproject file"
          : runnerType === "rust"
            ? "Cargo.toml"
            : "project.godot";
      return res.status(400).json({
        error: `No ${expectedHint} found in extracted Markdown project.`,
      });
    }

    const { projectDir, markerFile, projectName } = detected;
    const markerPath = path.join(projectDir, markerFile);

    state.status = "building";
    state.projectName = projectName;
    state.projectDir = projectDir;
    state.exitCode = null;
    state.error = null;
    state.logs = "";
    state.logBaseOffset = 0;
    state.tempDir = tempDir;

    const label =
      runnerType === "ue" ? "UE" : runnerType === "rust" ? "Rust" : "Godot";
    appendRunnerLog(
      state,
      `📦 Extracted ${label} project '${projectName}' to: ${projectDir}\n`,
    );

    if (runnerType === "ue") {
      appendRunnerLog(state, `🔧 UE_ROOT: ${process.env.UE_ROOT}\n`);
      injectUeScadPluginFallback(projectDir, markerPath);
    } else if (runnerType === "rust") {
      injectRustBuildFallback(projectDir);
    } else if (runnerType === "godot") {
      injectGodotAddonFallback(projectDir, markerPath);
    }

    const ignoreDirsByType = {
      ue: ["Plugins", "Binaries", "Intermediate", "Saved"],
      rust: ["target"],
      godot: ["addons", ".godot", ".import"],
    };

    const compiledCount = await precompileProjectScadFiles(projectDir, state, {
      ignoreDirs: ignoreDirsByType[runnerType] || [],
      writeGdIgnore: runnerType === "godot",
    });

    if (compiledCount > 0) {
      appendRunnerLog(
        state,
        `🧊 Pre-compiled ${compiledCount} .scad asset(s) to __scad_glbs/\n`,
      );
    }

    if (state.runId !== thisRunId) {
      cleanupDirSafe(tempDir);
      return res
        .status(409)
        .json({ error: "Run superseded by a newer request." });
    }

    const attachOutputStreams = (proc) => {
      proc.stdout?.on("data", (d) => {
        if (state.runId === thisRunId) appendRunnerLog(state, d.toString());
      });
      proc.stderr?.on("data", (d) => {
        if (state.runId === thisRunId) appendRunnerLog(state, d.toString());
      });
    };

    const handleLaunchError = (phaseLabel, err) => {
      if (state.runId !== thisRunId) return;
      state.process = null;
      state.status = "error";
      state.exitCode = -1;
      state.error = `Failed to launch ${phaseLabel}: ${err.message}`;
      appendRunnerLog(state, `\n❌ ${state.error}\n`);
      cleanupDirSafe(tempDir);
      state.tempDir = null;
    };

    if (runnerType === "ue") {
      const buildArgs = [
        `${projectName}Editor`,
        uePaths.platformName,
        "Development",
        markerPath,
      ];
      appendRunnerLog(
        state,
        `\n⚙️  Building ${projectName}Editor (${uePaths.platformName} Development)...\n`,
      );

      const buildProc = spawnRunnerCommand(
        uePaths.buildScript,
        buildArgs,
        projectDir,
      );
      state.process = buildProc;
      attachOutputStreams(buildProc);
      buildProc.on("error", (err) => handleLaunchError("build script", err));

      buildProc.on("close", (code) => {
        if (state.runId !== thisRunId) return;
        state.process = null;

        if (code !== 0) {
          state.status = "error";
          state.exitCode = code;
          state.error = `UBT compilation failed with exit code ${code}.`;
          appendRunnerLog(state, `\n❌ ${state.error}\n`);
          cleanupDirSafe(tempDir);
          state.tempDir = null;
          return;
        }

        state.status = "running";
        appendRunnerLog(
          state,
          "\n✅ Build succeeded! Launching Unreal Editor...\n",
        );

        const editorProc = spawnRunnerCommand(
          uePaths.editor,
          [markerPath, "-log"],
          projectDir,
        );
        state.process = editorProc;
        attachOutputStreams(editorProc);
        editorProc.on("error", (err) =>
          handleLaunchError("Unreal Editor", err),
        );

        editorProc.on("close", (edCode) => {
          if (state.runId !== thisRunId) return;
          state.process = null;
          state.exitCode = edCode;
          state.status = edCode === 0 || edCode === null ? "stopped" : "error";
          if (state.status === "error") {
            state.error = `Unreal Editor exited with code ${edCode}.`;
          }
          appendRunnerLog(
            state,
            `\n🏁 Unreal Editor exited with code ${edCode}.\n`,
          );
          cleanupDirSafe(tempDir);
          state.tempDir = null;
        });
      });
    } else if (runnerType === "rust") {
      const cargoCmd = process.platform === "win32" ? "cargo.exe" : "cargo";
      const cargoTargetDir =
        process.env.CARGO_TARGET_DIR ||
        path.join(os.tmpdir(), "scad-rust-target");
      const cargoEnv = {
        CARGO_TERM_COLOR: "never",
        CARGO_TARGET_DIR: cargoTargetDir,
      };

      appendRunnerLog(state, "\n🦀 Building Rust project (cargo build)...\n");

      const buildProc = spawnRunnerCommand(
        cargoCmd,
        ["build"],
        projectDir,
        cargoEnv,
      );
      state.process = buildProc;
      attachOutputStreams(buildProc);
      buildProc.on("error", (err) => handleLaunchError("cargo", err));

      buildProc.on("close", (code) => {
        if (state.runId !== thisRunId) return;
        state.process = null;

        if (code !== 0) {
          state.status = "error";
          state.exitCode = code;
          state.error = `Cargo build failed with exit code ${code}.`;
          appendRunnerLog(state, `\n❌ ${state.error}\n`);
          cleanupDirSafe(tempDir);
          state.tempDir = null;
          return;
        }

        state.status = "running";
        appendRunnerLog(
          state,
          "\n✅ Build succeeded! Launching Rust application (cargo run)...\n",
        );

        const runProc = spawnRunnerCommand(
          cargoCmd,
          ["run"],
          projectDir,
          cargoEnv,
        );
        state.process = runProc;
        attachOutputStreams(runProc);
        runProc.on("error", (err) =>
          handleLaunchError("Rust application", err),
        );

        runProc.on("close", (runCode) => {
          if (state.runId !== thisRunId) return;
          state.process = null;
          state.exitCode = runCode;
          state.status =
            runCode === 0 || runCode === null ? "stopped" : "error";
          if (state.status === "error") {
            state.error = `Rust application exited with code ${runCode}.`;
          }
          appendRunnerLog(
            state,
            `\n🏁 Rust application exited with code ${runCode}.\n`,
          );
          cleanupDirSafe(tempDir);
          state.tempDir = null;
        });
      });
    } else if (runnerType === "godot") {
      res.json({
        ok: true,
        runId: thisRunId,
        projectName,
        status: state.status,
      });

      setImmediate(() => {
        if (state.runId !== thisRunId) return;
        let godotBin;
        try {
          appendRunnerLog(state, "🔍 Locating Godot binary...\n");
          godotBin = getGodotBin();
          appendRunnerLog(state, `🕹️  Godot binary: ${godotBin}\n`);
        } catch (err) {
          handleLaunchError("Godot binary", err);
          return;
        }
        if (state.runId !== thisRunId) return;

        appendRunnerLog(state, "\n⚙️  Importing Godot project assets...\n");
        const importProc = spawnRunnerCommand(
          godotBin,
          ["--headless", "--editor", "--quit", "--path", projectDir],
          projectDir,
        );
        state.process = importProc;
        attachOutputStreams(importProc);
        importProc.on("error", (err) => handleLaunchError("Godot import", err));

        importProc.on("close", (importCode) => {
          if (state.runId !== thisRunId) return;
          state.process = null;

          if (importCode !== 0) {
            appendRunnerLog(
              state,
              `\n⚠️ Asset import finished with exit code ${importCode} (continuing launch)...\n`,
            );
          }

          state.status = "running";
          appendRunnerLog(state, "\n🎮 Launching Godot Engine...\n");

          const playProc = spawnRunnerCommand(
            godotBin,
            ["--path", projectDir],
            projectDir,
          );
          state.process = playProc;
          attachOutputStreams(playProc);
          playProc.on("error", (err) => handleLaunchError("Godot Engine", err));

          playProc.on("close", (playCode) => {
            if (state.runId !== thisRunId) return;
            state.process = null;
            state.exitCode = playCode;
            state.status =
              playCode === 0 || playCode === null ? "stopped" : "error";
            if (state.status === "error") {
              state.error = `Godot Engine exited with code ${playCode}.`;
            }
            appendRunnerLog(
              state,
              `\n🏁 Godot Engine exited with code ${playCode}.\n`,
            );
            cleanupDirSafe(tempDir);
            state.tempDir = null;
          });
        });
      });
      return;
    }

    res.json({
      ok: true,
      runId: thisRunId,
      projectName,
      status: state.status,
    });
  } catch (err) {
    cleanupDirSafe(tempDir);
    state.tempDir = null;
    state.status = "error";
    state.error = err.message;
    res.status(500).json({ error: err.message });
  }
}

for (const rType of RUNNER_TYPES) {
  app.get(`/api/${rType}/status`, (req, res) =>
    handleRunnerStatus(rType, req, res),
  );
  app.post(`/api/${rType}/stop`, (req, res) =>
    handleRunnerStop(rType, req, res),
  );
  app.post(`/api/${rType}/run`, (req, res) => handleRunnerRun(rType, req, res));
}

process.on("SIGINT", () => {
  stopAllActiveRuns();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAllActiveRuns();
  process.exit(0);
});

// ========================
// Serve Built Editor UI
// ========================
if (fs.existsSync(editorDistDir)) {
  // Serve the static files exactly how Vite bundled them
  app.use(express.static(editorDistDir));
} else {
  console.warn(
    "⚠️  Editor dist directory not found. Editor UI will not be available.",
  );
}

// Start Server
app.listen(port, () => {
  console.log(`🚀 scad-gltf serve listening on http://localhost:${port}`);
  if (fs.existsSync(editorDistDir)) {
    console.log(`🌐 Editor available at: http://localhost:${port}/`);
  }
  console.log(`📁 Managing .scad and .md files in directory: ${workDir}`);
  if (process.env.UE_ROOT) {
    console.log(`🎮 UE_ROOT: ${process.env.UE_ROOT}`);
  }
  if (process.env.GODOT_BIN) {
    console.log(`🕹️  GODOT_BIN: ${process.env.GODOT_BIN}`);
  }
});
