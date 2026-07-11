#!/usr/bin/env node
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { convertScadToGltf } from "../src/convert.js";

// Resolve the local paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../src/ext/openscad.wasm");
const editorDir = path.resolve(__dirname, "../editor");
const editorDistDir = path.join(editorDir, "dist");

// Polyfill fetch so the WASM loader works natively in Node.js
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const urlStr = url.toString();
  if (urlStr.startsWith("file://") || urlStr.endsWith(".wasm")) {
    const normalizedPath = urlStr.startsWith("file://")
      ? fileURLToPath(urlStr)
      : urlStr;

    const buffer = fs.readFileSync(normalizedPath);
    return new Response(buffer, {
      status: 200,
      headers: { "Content-Type": "application/wasm" },
    });
  }
  return originalFetch ? originalFetch(url, options) : undefined;
};

// Parse CLI arguments
const args = process.argv.slice(2);
let port = 3000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") {
    port = parseInt(args[i + 1]) || 3000;
    i++; // Skip the port number value
  }
}

// Target directory is the current working directory where the script is run
const workDir = process.cwd();

// ========================
// Editor Build Step
// ========================
console.log("⚙️  Checking editor build...");
try {
  // Check if editor dependencies are installed, if not, install them
  if (!fs.existsSync(path.join(editorDir, "node_modules"))) {
    console.log("📦 Installing editor dependencies...");
    execSync("npm install", { cwd: editorDir, stdio: "inherit" });
  }

  // Build the editor
  console.log("🛠️  Building editor...");
  execSync("npm run build", { cwd: editorDir, stdio: "inherit" });
  console.log("✅ Editor built successfully.\n");
} catch (err) {
  console.error("❌ Error building editor:", err.message);
  console.log("⚠️  Continuing without a fresh editor build...\n");
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
  return safeName.endsWith(".scad") ? safeName : `${safeName}.scad`;
}

// ========================
// SCAD File Management API
// ========================

// 1. List all .scad files in the current directory
app.get("/api/scads", (req, res) => {
  try {
    const files = fs
      .readdirSync(workDir)
      .filter(
        (file) =>
          file.toLowerCase().endsWith(".scad") &&
          fs.statSync(path.join(workDir, file)).isFile(),
      );

    res.json({ files });
  } catch (err) {
    console.error("Error reading directory:", err);
    res.status(500).json({ error: "Failed to list files." });
  }
});

// 2. Read specific .scad file content
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

// 3. Create or Update a .scad file
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

// 4. Delete a .scad file
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
      wasmUrl: `file://${wasmPath}`,
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
  console.log(`🚀 scad-serve listening on http://localhost:${port}`);
  if (fs.existsSync(editorDistDir)) {
    console.log(`🌐 Editor available at: http://localhost:${port}/`);
  }
  console.log(`📁 Managing .scad files in directory: ${workDir}`);
});
