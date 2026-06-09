#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { convertScadToGltf } from "../src/convert.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../src/ext/openscad.wasm");

global.fetch = async (url) => {
  const normalizedPath = url.toString().startsWith("file://")
    ? fileURLToPath(url.toString())
    : url.toString();

  const buffer = fs.readFileSync(normalizedPath);
  return new Response(buffer, {
    status: 200,
    headers: { "Content-Type": "application/wasm" },
  });
};

/**
 * Recursively resolves local dependencies (include / use) to extract their contents.
 * Returns a map of absolute file paths to their string contents.
 */
function getDependencies(filePath, visited = new Map()) {
  if (visited.has(filePath)) return visited;
  visited.set(filePath, ""); // Prevent infinite recursion cycles

  if (!fs.existsSync(filePath)) {
    return visited;
  }

  const content = fs.readFileSync(filePath, "utf8");
  visited.set(filePath, content);

  // Match include <...> or "..." and use <...> or "..."
  const includeRegex = /(?:include|use)\s*([<"])([^>"]+)([>"])/g;
  let match;
  while ((match = includeRegex.exec(content)) !== null) {
    const depRelativePath = match[2];
    const depAbsolutePath = path.resolve(
      path.dirname(filePath),
      depRelativePath,
    );
    getDependencies(depAbsolutePath, visited);
  }

  return visited;
}

async function run() {
  const allArgs = process.argv.slice(2);
  const useCache = allArgs.includes("--cache");
  const args = allArgs.filter((arg) => arg !== "--cache");

  const inputPath = args[0];
  const outputPath = args[1];
  const optionsJson = args[2];

  if (!inputPath || !outputPath) {
    console.error(
      "Usage: scad-convert <input.scad | input_dir> <output.glb | output_dir> [options_json] [--cache]",
    );
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file or directory not found: ${inputPath}`);
    process.exit(1);
  }

  const isInputDirectory = fs.statSync(inputPath).isDirectory();
  let inputFiles = [];

  if (isInputDirectory) {
    const files = fs.readdirSync(inputPath);
    for (const file of files) {
      if (file.toLowerCase().endsWith(".scad")) {
        inputFiles.push(path.join(inputPath, file));
      }
    }

    if (inputFiles.length === 0) {
      console.log(`No .scad files found in directory: ${inputPath}`);
      process.exit(0);
    }

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    } else if (!fs.statSync(outputPath).isDirectory()) {
      console.error("Output must be a directory when input is a directory.");
      process.exit(1);
    }
  } else {
    inputFiles.push(inputPath);
  }

  let options = {};
  if (optionsJson) {
    if (optionsJson.startsWith("{")) {
      options = JSON.parse(optionsJson);
    } else {
      const decoded = Buffer.from(optionsJson, "base64").toString("utf8");
      options = JSON.parse(decoded);
    }
  }

  let hasErrors = false;

  for (const file of inputFiles) {
    let finalOutputPath = outputPath;

    if (
      isInputDirectory ||
      (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory())
    ) {
      const baseName = path.basename(file, path.extname(file));
      finalOutputPath = path.join(outputPath, `${baseName}.glb`);
    } else {
      const ext = path.extname(outputPath).toLowerCase();
      if (ext !== ".glb" && ext !== ".gltf") {
        fs.mkdirSync(outputPath, { recursive: true });
        const baseName = path.basename(file, path.extname(file));
        finalOutputPath = path.join(outputPath, `${baseName}.glb`);
      } else {
        const parentDir = path.dirname(outputPath);
        if (!fs.existsSync(parentDir))
          fs.mkdirSync(parentDir, { recursive: true });
      }
    }

    const importFilePath = `${finalOutputPath}.import`;

    // 1. Gather all dependencies automatically
    const depsMap = getDependencies(file);
    const scadCode = depsMap.get(file);
    depsMap.delete(file);

    let totalContentForHash = scadCode;
    const additionalFiles = {};
    const baseDir = path.dirname(file);

    // Sort paths to ensure consistent deterministic hashing
    const sortedDepPaths = Array.from(depsMap.keys()).sort();
    for (const depPath of sortedDepPaths) {
      const content = depsMap.get(depPath);
      totalContentForHash += content;
      // Calculate path relative to the main file, normalize for VFS
      let relPath = path.relative(baseDir, depPath).replace(/\\/g, "/");
      additionalFiles[relPath] = content;
    }

    let needsConversion = true;
    let currentHash = null;

    if (useCache) {
      const hashData = totalContentForHash + JSON.stringify(options);
      currentHash = crypto.createHash("sha256").update(hashData).digest("hex");

      if (fs.existsSync(finalOutputPath) && fs.existsSync(importFilePath)) {
        try {
          const importData = JSON.parse(
            fs.readFileSync(importFilePath, "utf8"),
          );
          if (importData.hash === currentHash) {
            needsConversion = false;
          }
        } catch (e) {}
      }
    }

    if (!needsConversion) {
      console.log(`Skipped ${path.basename(file)} (no changes detected)`);
      continue;
    }

    if (useCache || isInputDirectory) {
      console.log(`Converting ${path.basename(file)} -> ${finalOutputPath}...`);
    }

    try {
      const glbData = await convertScadToGltf(scadCode, {
        wasmUrl: `file://${wasmPath}`,
        additionalFiles,
        ...options,
      });

      fs.writeFileSync(finalOutputPath, glbData);

      if (useCache) {
        fs.writeFileSync(
          importFilePath,
          JSON.stringify(
            {
              hash: currentHash,
              source: path.basename(file),
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
      }
    } catch (error) {
      console.error(`SCAD Conversion Error for ${file}:`, error);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error("Batch completed with errors.");
    process.exit(1);
  }

  process.exit(0);
}

run();
