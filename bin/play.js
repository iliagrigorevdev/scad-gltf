#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, spawn } from "node:child_process";
import { getGodotBin } from "../src/godot-utils.js";
import {
  extractFilesFromMarkdown,
  writeExtractedFiles,
} from "../src/cli-utils.js";

function main() {
  const packedScriptPath = process.argv[2];

  if (!packedScriptPath) {
    console.error(
      "❌ Error: Path to the generated Markdown project file is required.",
    );
    console.error("Usage: scad-gltf play <path_to_generated_project.md>");
    process.exit(1);
  }

  const absScriptPath = path.resolve(process.cwd(), packedScriptPath);
  if (!fs.existsSync(absScriptPath)) {
    console.error(`❌ Error: File not found: ${absScriptPath}`);
    process.exit(1);
  }

  // 1. Create a unique temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scad-play-"));
  console.log(`📦 Unpacking project to temporary directory...\n   ${tempDir}`);

  let appProcess = null;

  // Ensure cleanup happens on exit
  const cleanup = () => {
    if (fs.existsSync(tempDir)) {
      console.log(`\n🧹 Cleaning up temporary directory...`);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`⚠️ Failed to fully clean up temp dir: ${e.message}`);
      }
    }
  };

  process.on("SIGINT", () => {
    if (appProcess) appProcess.kill("SIGINT");
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    if (appProcess) appProcess.kill("SIGTERM");
    cleanup();
    process.exit(0);
  });

  try {
    const ext = path.extname(absScriptPath).toLowerCase();

    // 2. Extract files based on extension
    if (ext === ".js") {
      // Legacy support for older node.js script generations
      console.log(
        `\n⚙️  Running legacy generator script: ${path.basename(absScriptPath)}`,
      );
      execSync(`node "${absScriptPath}"`, { cwd: tempDir, stdio: "inherit" });
    } else if (ext === ".md") {
      console.log(
        `\n⚙️  Extracting Markdown project: ${path.basename(absScriptPath)}`,
      );
      const mdContent = fs.readFileSync(absScriptPath, "utf-8");
      const files = extractFilesFromMarkdown(mdContent);

      if (Object.keys(files).length === 0) {
        console.error(
          "\n❌ Error: No files could be extracted from the Markdown. Make sure it uses '### filepath' headers followed by code blocks.",
        );
        cleanup();
        process.exit(1);
      }

      writeExtractedFiles(files, tempDir);
    } else {
      console.error(
        "\n❌ Error: Unsupported file type. Please provide a .md or .js generated project file.",
      );
      cleanup();
      process.exit(1);
    }

    // 3. Find the resulting project folder and determine its type
    let projectDir = null;
    let projectType = null; // 'godot' | 'web' | 'rust'
    let latestTime = 0;

    const items = fs.readdirSync(tempDir);
    for (const item of items) {
      const itemPath = path.join(tempDir, item);
      if (fs.statSync(itemPath).isDirectory()) {
        const isGodot = fs.existsSync(path.join(itemPath, "project.godot"));
        const isWeb = fs.existsSync(path.join(itemPath, "package.json"));
        const isRust = fs.existsSync(path.join(itemPath, "Cargo.toml"));

        if (isGodot || isWeb || isRust) {
          const mtime = fs.statSync(itemPath).mtimeMs;
          if (mtime > latestTime) {
            latestTime = mtime;
            projectDir = itemPath;
            projectType = isGodot ? "godot" : isRust ? "rust" : "web";
          }
        }
      }
    }

    if (!projectDir || !projectType) {
      console.error("\n❌ Error: Could not find a valid generated project.");
      console.error(
        "The project did not contain a root folder holding 'project.godot', 'package.json', or 'Cargo.toml'.",
      );
      cleanup();
      process.exit(1);
    }

    console.log(
      `\n✔️  Found extracted ${projectType.toUpperCase()} project: ${path.basename(projectDir)}`,
    );

    // 4. Boot the corresponding environment
    if (projectType === "godot") {
      const godotBin = getGodotBin();

      console.log(`\n⚙️  Importing Godot assets (this may take a moment)...`);
      try {
        // Force Godot to build the .godot/imported cache before attempting to run the project
        execSync(`"${godotBin}" --headless --editor --quit`, {
          cwd: projectDir,
          stdio: "inherit",
        });
      } catch (e) {
        console.log(
          "⚠️ Asset import finished with non-zero exit code (continuing...)",
        );
      }

      console.log(`\n🎮 Launching Godot Engine...`);
      appProcess = spawn(godotBin, ["--path", projectDir], {
        stdio: "inherit",
      });
    } else if (projectType === "web") {
      console.log(
        `\n🌐 Installing NPM dependencies (this may take a moment)...`,
      );
      try {
        execSync("npm install", { cwd: projectDir, stdio: "inherit" });
      } catch (e) {
        console.log(
          "⚠️ npm install failed or showed errors, attempting to continue anyway...",
        );
      }

      console.log(`\n🌐 Starting Vite dev server...`);
      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

      appProcess = spawn(npmCmd, ["run", "dev"], {
        cwd: projectDir,
        stdio: "inherit",
      });
    } else if (projectType === "rust") {
      console.log(
        `\n🦀 Compiling and starting Rust project (this may take a moment)...`,
      );
      const cargoCmd = process.platform === "win32" ? "cargo.exe" : "cargo";
      appProcess = spawn(cargoCmd, ["run"], {
        cwd: projectDir,
        stdio: "inherit",
      });
    }

    // 5. Handle lifecycle events
    appProcess.on("close", (code) => {
      console.log(`\n🏁 Process exited with code ${code}.`);
      cleanup();
      process.exit(code || 0);
    });

    appProcess.on("error", (err) => {
      console.error(`\n❌ Failed to start the application: ${err.message}`);
      cleanup();
      process.exit(1);
    });
  } catch (err) {
    console.error(`\n❌ An error occurred during execution:\n`, err.message);
    cleanup();
    process.exit(1);
  }
}

main();
