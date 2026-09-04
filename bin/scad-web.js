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
      'Usage: scad-web "<description of the web app to generate>" [options_json]',
    );
    console.error('   or: echo "<description>" | scad-web [options_json]');
    console.error("");
    console.error("Example with JSON options:");
    console.error(
      '  scad-web "3D Car Configurator Web App" \'{"animation": false}\'',
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

  // Disable the modelName instructions specifically for this wrapper context
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
    promptRules = generatePrompt("the 3D assets for the web app", options);
  } catch (e) {
    console.error("Error generating prompt rules from prompt.js:");
    console.error(e);
    process.exit(1);
  }

  // 4. Construct the Main Web Prompt System Text (System Instructions)
  const systemPrompt = `You are an expert Web 3D developer and procedural 3D technical artist.

What to generate:
1. 3D Web Assets (.scad):
   - Generate procedural 3D models for the web app using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Skeletal Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Vite Web Project Files (npm based):
   - Create the necessary files for a modern web application (e.g., \`package.json\`, \`index.html\`, \`main.js\`).
   - You can use ANY web 3D library with glTF support (e.g., Three.js, Babylon.js, @google/model-viewer, PlayCanvas, A-Frame, etc.) that fits the app's requirements.
   - In \`package.json\`, you MUST include the scad to gltf converter tool as a dev dependency from GitHub:
     \`"scad-gltf": "github:iliagrigorevdev/scad-gltf"\`
   - In \`package.json\`, add npm scripts to automatically compile the \`.scad\` files into \`.glb\` format inside the \`public/\` folder before Vite runs its dev or build steps.
     For example:
     \`"predev": "scad-convert ./scad ./public/models --cache"\`
     \`"prebuild": "scad-convert ./scad ./public/models --cache"\`
   - Write the core application logic to load and display the converted \`.glb\` files interactively.

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using a slugified version of the project name) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` 3D assets.
     - Your generated Vite web project files.
   - Ensure all string file contents inside the Node.js script are properly escaped.`;

  // 5. Format the unified system instructions clipboard output
  let systemClipboardOutput = `### SYSTEM_PROMPT\n---\n\`\`\`\n${systemPrompt}\n\`\`\`\n\n`;

  // 6. Format the input request output
  const inputRequestOutput = `Input Task:\nDesign and implement a web-based 3D glTF app using Vite for the following concept: "${task}"`;

  // 7. Write to System Clipboard (Part 1: System Instructions)
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

  // 8. Await user confirmation
  await waitForEnter(
    "Please paste the system instructions into your LLM, then press ENTER to copy your input request...",
  );

  // 9. Write to System Clipboard (Part 2: Input Request)
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
