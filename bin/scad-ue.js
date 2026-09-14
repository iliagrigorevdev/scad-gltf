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
      'Usage: scad-ue "<description of the game to generate>" [options_json]',
    );
    console.error('   or: echo "<description>" | scad-ue [options_json]');
    console.error("");
    console.error("Example with JSON options:");
    console.error(
      '  scad-ue "Game description" \'{"animation": false, "bakeColors": true}\'',
    );
    process.exit(1);
  }

  // 2. Parse Options JSON
  // Disable heavy PBR features by default
  let options = {
    transmission: false,
    clearcoat: false,
    sheen: false,
    iridescence: false,
  };

  if (optionsStr) {
    try {
      const parsed = JSON.parse(optionsStr);
      options = { ...options, ...parsed }; // User provided options override defaults
    } catch (e) {
      console.error(`Invalid JSON options: ${optionsStr}`);
      process.exit(1);
    }
  }

  // Disable the modelName instructions specifically for the wrapper context
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

  // 4. Construct the Main Unreal Engine Prompt System Text (System Instructions)
  const systemPrompt = `You are an expert Unreal Engine 5 C++ game developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, C++ classes, and structs MUST strictly use standard Unreal Engine PascalCase naming conventions (e.g., \`MyGameMode.cpp\`, \`AMyPlayerCharacter\`).
- Use standard UE prefixes: 'A' for Actors, 'U' for UObjects, 'F' for Structs.
- 3D asset files (.scad) should use PascalCase (e.g., \`PlayerCharacter.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
1. 3D Game Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - Scale & Units: 1 OpenSCAD unit = 1 Meter. (Unreal's GLTF importer automatically scales this to Unreal Units / centimeters). Design your models using realistic meter-based scales (e.g., a character should be ~1.8 units tall).
   - Coordinate System & Forward Convention: Write standard OpenSCAD Z-up code (+Z is UP, XY plane is ground). Build objects standing upright and facing Front (Positive Y-axis).
   - Left/Right Convention: Always name and position "left" and "right" components (e.g., LeftArm, RightEye) based on the object's anatomical point of view (facing Forward towards +Y).
   - CRITICAL Coordinate Mapping: The SCAD to glTF converter combined with Unreal's GLTF importer automatically maps OpenSCAD's coordinate system to Unreal Engine's coordinate system (Z-Up, X-Forward, Y-Right). Design your models naturally in OpenSCAD using this exact mapping:
     * OpenSCAD +Y (Forward) -> Unreal +X (Forward)
     * OpenSCAD -Y (Back)    -> Unreal -X (Back)
     * OpenSCAD +X (Right)   -> Unreal +Y (Right)
     * OpenSCAD -X (Left)    -> Unreal -Y (Left)
     * OpenSCAD +Z (Up)      -> Unreal +Z (Up)
     DO NOT manually apply root rotations in OpenSCAD to compensate for Unreal.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Skeletal Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Unreal Engine 5 Project Files:
   - Create the necessary C++ files (.h and .cpp), a \`.uproject\` file, and Unreal build system files (\`.Target.cs\`, \`.Build.cs\`) to implement the game logic, responsive player input controls, and a core gameplay loop.
   - Configure the project to automatically enable the \`ScadImporter\` plugin and the \`Interchange\` framework in the \`.uproject\` file.
   - UE C++ Coordinate, Forward, and Left/Right Conventions:
     * Forward is +X: \`FVector::ForwardVector\` or \`GetActorForwardVector()\`.
     * Right is +Y: \`FVector::RightVector\` or \`GetActorRightVector()\`.
     * Up is +Z: \`FVector::UpVector\` or \`GetActorUpVector()\`.
   - Asset loading: The ScadImporter plugin will automatically compile and import the .scad files into .uasset files (UStaticMesh / USkeletalMesh) on the FIRST launch of the editor.
     - CRITICAL C++ ASSET LOADING RULE: Because the .scad files are compiled to .uasset dynamically during the editor's initial startup, the .uasset files DO NOT EXIST when C++ Class Default Objects (CDO) are constructed.
       * NEVER use \`ConstructorHelpers::FObjectFinder\` or \`FClassFinder\` to reference your generated meshes in C++ constructors! This will crash or fail initialization.
       * INSTEAD, expose the meshes as \`UPROPERTY(EditAnywhere)\` and tell the user to assign them in a derived Blueprint, OR load them dynamically at runtime in \`BeginPlay()\` using \`LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Models/YourModel.YourModel"))\`.
   - Generate a \`.gitignore\` file tailored for Unreal Engine projects.
   - Generate a \`README.md\` file that documents the project.

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using PascalCase, e.g., \`MyGameProject\`) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` game assets inside a \`Content/Models/\` directory.
     - Your generated Unreal project files (\`Source\`, \`Config\`, \`.uproject\`).
     - The exact source code of the provided \`ue/Plugins/ScadImporter/*\` files, which must be mapped and placed into the generated project's \`Plugins/ScadImporter/\` directory.
   - Ensure all string file contents inside the Node.js script are properly escaped.`;

  // 5. Gather Plugin Files content recursively
  const pluginDir = path.join(DIR, "ue", "Plugins", "ScadImporter");
  let pluginFiles = [];

  function readDirRecursive(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      const fullPath = path.join(currentDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        readDirRecursive(fullPath);
      } else {
        // Only grab readable code text files
        if (/\.(uplugin|cs|cpp|h)$/i.test(file)) {
          pluginFiles.push(fullPath);
        }
      }
    }
  }

  try {
    readDirRecursive(pluginDir);
  } catch (e) {
    console.error("Warning: Could not read plugin directory.", e);
  }

  // 6. Format the unified system instructions clipboard output
  let systemClipboardOutput = `${systemPrompt}\n\n`;

  for (const file of pluginFiles) {
    try {
      // Normalize line endings to avoid mixed line-ending layout loops in web editors
      const content = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
      // Format to use relative paths and force forward slashes for LLM clarity
      const relativePath = path.relative(DIR, file).replace(/\\/g, "/");

      // Add explicit language tags
      let lang = "text";
      if (file.endsWith(".cpp") || file.endsWith(".h")) lang = "cpp";
      else if (file.endsWith(".cs")) lang = "csharp";
      else if (file.endsWith(".uplugin")) lang = "json";

      systemClipboardOutput += `### ${relativePath}\n---\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
    } catch (e) {
      console.error(`Warning: Skipping '${file}'. It is not a readable file.`);
    }
  }

  systemClipboardOutput = systemClipboardOutput.trimEnd() + "\n";

  // 7. Format the input request output
  const inputRequestOutput = `Design and implement an Unreal Engine 5 project for the following game concept: "${task}"`;

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
