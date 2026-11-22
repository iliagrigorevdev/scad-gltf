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

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") {
    port = parseInt(args[i + 1]) || 3000;
    i++; // Skip the port number value
  } else if (args[i] === "--ue-root") {
    ueRootArg = args[i + 1] || "";
    i++;
  }
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
// Unreal Engine Project Runner API
// ========================
const ueRunState = {
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

function appendUeLog(text) {
  if (!text) return;
  ueRunState.logs += text;
  const maxChars = 500000;
  if (ueRunState.logs.length > maxChars) {
    const drop = ueRunState.logs.length - maxChars;
    ueRunState.logs = ueRunState.logs.slice(drop);
    ueRunState.logBaseOffset += drop;
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

function stopActiveUeRun(markStopped = true) {
  ueRunState.runId += 1;
  const proc = ueRunState.process;
  const tempDir = ueRunState.tempDir;
  ueRunState.process = null;
  ueRunState.tempDir = null;

  if (proc) {
    killChildProcessTree(proc);
  }
  if (tempDir) {
    cleanupDirSafe(tempDir);
  }
  if (
    markStopped &&
    (ueRunState.status === "building" || ueRunState.status === "running")
  ) {
    ueRunState.status = "stopped";
    appendUeLog("\n⏹ Stopped by user.\n");
  }
}

function findUeProjectInTempDir(tempDir) {
  const candidates = [tempDir];
  for (const entry of fs.readdirSync(tempDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      candidates.push(path.join(tempDir, entry.name));
    }
  }
  for (const dir of candidates) {
    const uproject = fs
      .readdirSync(dir)
      .find((f) => f.toLowerCase().endsWith(".uproject"));
    if (uproject) {
      return {
        projectDir: dir,
        uprojectFile: uproject,
        projectName: path.basename(uproject, ".uproject"),
      };
    }
  }
  return null;
}

function injectUeScadPluginFallback(projectDir, uprojectPath) {
  const ueDir = path.resolve(__dirname, "../ue");
  const pluginTemplateDir = path.join(ueDir, "Plugins", "ScadImporter");
  if (!fs.existsSync(pluginTemplateDir)) return;

  const uprojectContent = fs.readFileSync(uprojectPath, "utf8");
  const hasScadPluginRef = /ScadImporter/.test(uprojectContent);
  let hasScadFiles = false;

  function scanScad(dir) {
    if (hasScadFiles || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (
          [
            "Plugins",
            "Binaries",
            "Intermediate",
            "Saved",
            "__scad_glbs",
          ].includes(entry.name)
        ) {
          continue;
        }
        scanScad(path.join(dir, entry.name));
      } else if (isScadFilePath(entry.name)) {
        hasScadFiles = true;
        return;
      }
    }
  }
  scanScad(projectDir);

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

async function precompileUeScadFiles(projectDir) {
  const scadPaths = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          [
            "Plugins",
            "Binaries",
            "Intermediate",
            "Saved",
            "__scad_glbs",
          ].includes(entry.name)
        ) {
          continue;
        }
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
        appendUeLog(
          `[SCAD] Skipped helper library ${relPosix} (no top-level geometry).\n`,
        );
      } else {
        appendUeLog(
          `[SCAD] Warning: failed precompiling ${relPosix}: ${msg}\n`,
        );
      }
    }
  }
  return compiledCount;
}

function spawnUeCommand(command, args, cwd) {
  const isWinBat =
    process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command);
  if (isWinBat) {
    const quotedCmd = [`"${command}"`, ...args.map((a) => `"${a}"`)].join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", quotedCmd], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

app.get("/api/ue/status", (req, res) => {
  const since = Math.max(0, parseInt(req.query.since, 10) || 0);
  const totalOffset = ueRunState.logBaseOffset + ueRunState.logs.length;
  const startIdx = Math.max(0, since - ueRunState.logBaseOffset);
  const chunk = ueRunState.logs.slice(startIdx);

  res.json({
    runId: ueRunState.runId,
    status: ueRunState.status,
    running:
      ueRunState.status === "building" || ueRunState.status === "running",
    projectName: ueRunState.projectName,
    ueConfigured: Boolean(process.env.UE_ROOT),
    exitCode: ueRunState.exitCode,
    error: ueRunState.error,
    logs: chunk,
    nextOffset: totalOffset,
  });
});

app.post("/api/ue/stop", (_req, res) => {
  stopActiveUeRun(true);
  res.json({ ok: true, status: ueRunState.status });
});

app.post("/api/ue/run", async (req, res) => {
  const { markdown } = req.body || {};
  if (!markdown || typeof markdown !== "string") {
    return res
      .status(400)
      .json({ error: "Missing 'markdown' project content." });
  }

  let paths;
  try {
    paths = getUePaths();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const files = extractFilesFromMarkdown(markdown);
  if (Object.keys(files).length === 0) {
    return res.status(400).json({
      error:
        "No files could be extracted from Markdown. Ensure '### filepath' headers and code blocks are used.",
    });
  }

  stopActiveUeRun(false);
  const thisRunId = ++ueRunState.runId;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scad-ue-run-"));

  try {
    writeExtractedFiles(files, tempDir);
    const detected = findUeProjectInTempDir(tempDir);
    if (!detected) {
      cleanupDirSafe(tempDir);
      return res.status(400).json({
        error: "No .uproject file found in extracted Markdown project.",
      });
    }

    const { projectDir, uprojectFile, projectName } = detected;
    const uprojectPath = path.join(projectDir, uprojectFile);

    ueRunState.status = "building";
    ueRunState.projectName = projectName;
    ueRunState.projectDir = projectDir;
    ueRunState.exitCode = null;
    ueRunState.error = null;
    ueRunState.logs = "";
    ueRunState.logBaseOffset = 0;
    ueRunState.tempDir = tempDir;

    appendUeLog(`📦 Extracted UE project '${projectName}' to: ${projectDir}\n`);
    appendUeLog(`🔧 UE_ROOT: ${process.env.UE_ROOT}\n`);

    injectUeScadPluginFallback(projectDir, uprojectPath);
    const compiledCount = await precompileUeScadFiles(projectDir);
    if (compiledCount > 0) {
      appendUeLog(
        `🧊 Pre-compiled ${compiledCount} .scad asset(s) to __scad_glbs/\n`,
      );
    }

    if (ueRunState.runId !== thisRunId) {
      cleanupDirSafe(tempDir);
      return res
        .status(409)
        .json({ error: "Run superseded by a newer request." });
    }

    const buildArgs = [
      `${projectName}Editor`,
      paths.platformName,
      "Development",
      uprojectPath,
    ];
    appendUeLog(
      `\n⚙️  Building ${projectName}Editor (${paths.platformName} Development)...\n`,
    );

    const buildProc = spawnUeCommand(paths.buildScript, buildArgs, projectDir);
    ueRunState.process = buildProc;

    buildProc.stdout?.on("data", (d) => {
      if (ueRunState.runId === thisRunId) appendUeLog(d.toString());
    });
    buildProc.stderr?.on("data", (d) => {
      if (ueRunState.runId === thisRunId) appendUeLog(d.toString());
    });

    buildProc.on("error", (err) => {
      if (ueRunState.runId !== thisRunId) return;
      ueRunState.process = null;
      ueRunState.status = "error";
      ueRunState.exitCode = -1;
      ueRunState.error = `Failed to launch build script: ${err.message}`;
      appendUeLog(`\n❌ ${ueRunState.error}\n`);
      cleanupDirSafe(tempDir);
      ueRunState.tempDir = null;
    });

    buildProc.on("close", (code) => {
      if (ueRunState.runId !== thisRunId) return;
      ueRunState.process = null;

      if (code !== 0) {
        ueRunState.status = "error";
        ueRunState.exitCode = code;
        ueRunState.error = `UBT compilation failed with exit code ${code}.`;
        appendUeLog(`\n❌ ${ueRunState.error}\n`);
        cleanupDirSafe(tempDir);
        ueRunState.tempDir = null;
        return;
      }

      ueRunState.status = "running";
      appendUeLog("\n✅ Build succeeded! Launching Unreal Editor...\n");

      const editorProc = spawnUeCommand(
        paths.editor,
        [uprojectPath, "-log"],
        projectDir,
      );
      ueRunState.process = editorProc;

      editorProc.stdout?.on("data", (d) => {
        if (ueRunState.runId === thisRunId) appendUeLog(d.toString());
      });
      editorProc.stderr?.on("data", (d) => {
        if (ueRunState.runId === thisRunId) appendUeLog(d.toString());
      });

      editorProc.on("error", (err) => {
        if (ueRunState.runId !== thisRunId) return;
        ueRunState.process = null;
        ueRunState.status = "error";
        ueRunState.exitCode = -1;
        ueRunState.error = `Failed to launch Unreal Editor: ${err.message}`;
        appendUeLog(`\n❌ ${ueRunState.error}\n`);
        cleanupDirSafe(tempDir);
        ueRunState.tempDir = null;
      });

      editorProc.on("close", (edCode) => {
        if (ueRunState.runId !== thisRunId) return;
        ueRunState.process = null;
        ueRunState.exitCode = edCode;
        ueRunState.status =
          edCode === 0 || edCode === null ? "stopped" : "error";
        if (ueRunState.status === "error") {
          ueRunState.error = `Unreal Editor exited with code ${edCode}.`;
        }
        appendUeLog(`\n🏁 Unreal Editor exited with code ${edCode}.\n`);
        cleanupDirSafe(tempDir);
        ueRunState.tempDir = null;
      });
    });

    res.json({
      ok: true,
      runId: thisRunId,
      projectName,
      status: ueRunState.status,
    });
  } catch (err) {
    cleanupDirSafe(tempDir);
    ueRunState.tempDir = null;
    ueRunState.status = "error";
    ueRunState.error = err.message;
    res.status(500).json({ error: err.message });
  }
});

process.on("SIGINT", () => {
  stopActiveUeRun(false);
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopActiveUeRun(false);
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
});
