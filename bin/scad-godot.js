#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import readline from "node:readline";

// Safely resolve symlinks to find the actual package directory
const __filename = fs.realpathSync(url.fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);
const DIR = path.resolve(__dirname, "..");

// Safely detect if actual data is being piped into the script via STDIN
function hasStdinData() {
  try {
    const stat = fs.fstatSync(0); // 0 is the file descriptor for STDIN
    // isFIFO means piped (echo "foo" | script)
    // isFile means redirected (script < foo.txt)
    return stat.isFIFO() || stat.isFile();
  } catch (e) {
    return false;
  }
}

// Writes text to system clipboard
async function writeToClipboard(text) {
  const clipboardy = (await import("clipboardy")).default;
  await clipboardy.write(text);
}

function waitForEnter(message) {
  return new Promise((resolve) => {
    // If standard input was piped/redirected, we need to bypass it and read from the actual terminal
    if (!process.stdin.isTTY) {
      try {
        const tty = process.platform === "win32" ? "CONIN$" : "/dev/tty";
        const fd = fs.openSync(tty, "rs");
        process.stdout.write(message);
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, null);
        fs.closeSync(fd);
        console.log();
        resolve();
        return;
      } catch (e) {
        console.log(
          message +
            " (Auto-continuing due to non-interactive terminal environment)",
        );
        resolve();
        return;
      }
    }

    // For standard TTY terminals
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  let task = "";
  let optionsStr = "{}";

  // 1. Read TASK and OPTIONS
  if (hasStdinData()) {
    try {
      task = fs.readFileSync(0, "utf-8").trim();
    } catch (e) {
      console.error("Error reading from STDIN:", e);
    }
    if (process.argv[2]) optionsStr = process.argv[2];
  } else {
    if (process.argv[2]) task = process.argv[2];
    if (process.argv[3]) optionsStr = process.argv[3];
  }

  if (!task) {
    console.error("Error: Task parameter is required.");
    console.error(
      'Usage: scad-godot "<description of the game to generate>" [options_json]',
    );
    console.error('   or: echo "<description>" | scad-godot [options_json]');
    console.error("");
    console.error("Example with JSON options:");
    console.error(
      '  scad-godot "Game description" \'{"animation": false, "transmission": false}\'',
    );
    process.exit(1);
  }

  // 2. Parse Options JSON
  let options = {};
  if (optionsStr) {
    try {
      options = JSON.parse(optionsStr);
    } catch (e) {
      console.error(`Invalid JSON options: ${optionsStr}`);
      process.exit(1);
    }
  }

  // Disable the modelName instructions specifically for the Godot wrapper context
  options.modelName = false;

  // 3. Dynamically import and generate prompt rules from src/prompt.js
  let generatePrompt;
  try {
    const promptJsPath = path.join(DIR, "src", "prompt.js");
    const promptModuleUrl = url.pathToFileURL(promptJsPath).href;
    const m = await import(promptModuleUrl);
    generatePrompt = m.generatePrompt;
  } catch (e) {
    console.error(`Error loading ${path.join("src", "prompt.js")}:`, e);
    process.exit(1);
  }

  let promptRules = "";
  try {
    promptRules = generatePrompt("the 3D assets for the game", options);
  } catch (e) {
    console.error("Error generating prompt rules from prompt.js:");
    console.error(e);
    process.exit(1);
  }

  // 4. Construct the Main Godot Prompt System Text (System Instructions)
  const systemPrompt = `You are an expert Godot 4 game developer and procedural 3D technical artist.

What to generate:
1. 3D Game Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter used by the Godot importer automatically converts OpenSCAD's Z-up coordinate system to Godot's Y-up coordinate system. Design your models naturally in OpenSCAD using this exact mapping:
     * OpenSCAD +X (Right)   -> Godot +X (Right)
     * OpenSCAD +Y (Forward) -> Godot -Z (Forward)
     * OpenSCAD +Z (Up)      -> Godot +Y (Up)
     DO NOT manually apply root rotations (e.g., \`rotate([90, 0, 0])\`) to compensate for Godot.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Skeletal Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Godot 4 Project Files:
   - Create the necessary GDScript (\`.gd\`) and scene (\`.tscn\`) files to implement the game logic, responsive player input controls, and a core gameplay loop.
   - The scenes should directly instance the generated \`.scad\` files (the provided addon will handle importing them as 3D scenes).
   - Generate a \`project.godot\` file. It must configure the project and automatically enable the \`scad_importer\` plugin.
   - Generate a \`.gitignore\` file that ignores the \`.godot/\` folder.
   - Generate a \`README.md\` file that documents the project, gameplay mechanics, and controls.

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using a slugified version of the project name) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` game assets.
     - Your generated Godot project files.
     - The exact source code of the provided \`addons/scad_importer/*\` files, placed in their correct respective paths.
   - Ensure all string file contents inside the Node.js script are properly escaped.`;

  // 5. Gather Addon Files content
  const addonDir = path.join(DIR, "godot", "addons", "scad_importer");
  let addonFiles = [];
  try {
    if (fs.existsSync(addonDir)) {
      const files = fs.readdirSync(addonDir);
      for (const file of files) {
        const fullPath = path.join(addonDir, file);
        if (fs.statSync(fullPath).isFile()) {
          addonFiles.push(fullPath);
        }
      }
    }
  } catch (e) {
    console.error("Warning: Could not read addon directory.", e);
  }

  // 6. Format the unified system instructions clipboard output
  let systemClipboardOutput = "";

  systemClipboardOutput += `### SYSTEM_PROMPT\n---\n\`\`\`\n${systemPrompt}\n\`\`\`\n\n`;

  for (const file of addonFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      // Format to use relative paths and force forward slashes for LLM clarity
      const relativePath = path.relative(DIR, file).replace(/\\/g, "/");
      systemClipboardOutput += `### ${relativePath}\n---\n\`\`\`\n${content}\n\`\`\`\n\n`;
    } catch (e) {
      console.error(`Warning: Skipping '${file}'. It is not a readable file.`);
    }
  }

  systemClipboardOutput = systemClipboardOutput.trimEnd() + "\n";

  // 7. Format the input request output
  const inputRequestOutput = `Input Task:\nDesign and implement a Godot 4 project for the following game concept: "${task}"`;

  // 8. Write to System Clipboard (Part 1: System Instructions)
  try {
    await writeToClipboard(systemClipboardOutput);
    console.log("✔️  System instructions have been copied to the clipboard.");
  } catch (err) {
    console.error(
      "Error: Failed to copy system instructions to the clipboard.",
    );
    console.error(err.message);
    process.exit(1);
  }

  // 9. Await user confirmation
  await waitForEnter(
    "Please paste the system instructions into your LLM, then press ENTER to copy your input request...",
  );

  // 10. Write to System Clipboard (Part 2: Input Request)
  try {
    await writeToClipboard(inputRequestOutput);
    console.log(
      "✔️  Input request has been copied to the clipboard. You can now paste it into your LLM.",
    );
  } catch (err) {
    console.error("Error: Failed to copy input request to the clipboard.");
    console.error(err.message);
    process.exit(1);
  }
}

// Execute and handle unhandled runtime errors
main().catch((err) => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
