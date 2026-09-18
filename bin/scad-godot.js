#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { generatePrompt } from "../src/prompt.js";
import {
  parseTaskAndOptions,
  writeToClipboard,
  waitForEnter,
  runAutomatedGeminiFlow,
} from "../src/cli-utils.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR = path.resolve(__dirname, "..");

async function main() {
  const { task, optionsStr } = parseTaskAndOptions();

  if (!task) {
    console.error("Error: Task parameter is required.");
    console.error(
      'Usage: scad-godot "<description of the game to generate>" [options_json]',
    );
    console.error('   or: echo "<description>" | scad-godot [options_json]');
    console.error("");
    console.error("Example with JSON options:");
    console.error(
      '  scad-godot "Game description" \'{"animation": false, "bakeColors": true, "geminiApiKey": "AIzaSy...", "geminiModel": "gemini-3.8-flash", "scadFiles": ["player.scad"]}\'',
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
    scadFiles: [],
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

  // Disable the modelName instructions specifically for the Godot wrapper context
  options.modelName = false;

  let promptRules = "";
  try {
    promptRules = generatePrompt("the 3D assets for the game", options);
  } catch (e) {
    console.error("Error generating prompt rules from prompt.js:");
    console.error(e);
    process.exit(1);
  }

  const hasUserScadFiles =
    Array.isArray(options.scadFiles) && options.scadFiles.length > 0;

  // 4. Construct the Main Godot Prompt System Text (System Instructions)
  const systemPrompt = `You are an expert Godot 4 game developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, scenes, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.gd\`, \`main_scene.tscn\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
1. 3D Game Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - Scale & Units: 1 OpenSCAD unit = 1 Godot meter. Design your models using realistic meter-based scales (e.g., a character should be ~1.8 units tall). DO NOT use millimeter-based scaling.
   - Coordinate System & Forward Convention: Write standard OpenSCAD Z-up code (+Z is UP, XY plane is ground). Build objects standing upright and facing Front (Positive Y-axis).
   - Left/Right Convention: Always name and position "left" and "right" components (e.g., LeftArm, RightEye) based on the object's anatomical point of view (facing Forward towards +Y), NOT the camera/viewer's screen perspective. Because the object faces +Y, the object's Left side is along the -X axis, and the object's Right side is along the +X axis.
   - CRITICAL Coordinate Mapping: The SCAD to glTF converter used by the Godot importer automatically converts OpenSCAD's Z-up coordinate system to Godot's Y-up coordinate system. Design your models naturally in OpenSCAD using this exact mapping:
     * OpenSCAD +X (Right)   -> Godot +X (Right)
     * OpenSCAD -X (Left)    -> Godot -X (Left)
     * OpenSCAD +Y (Forward) -> Godot -Z (Forward)
     * OpenSCAD -Y (Back)    -> Godot +Z (Back)
     * OpenSCAD +Z (Up)      -> Godot +Y (Up)
     DO NOT manually apply root rotations (e.g., \`rotate([90, 0, 0])\`) to compensate for Godot.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Godot 4 Project Files:
   - Create the necessary GDScript (\`.gd\`) and scene (\`.tscn\`) files to implement the game logic, responsive player input controls, and a core gameplay loop.
   - The scenes should directly instance the generated \`.scad\` files (the provided addon will handle importing them as 3D scenes).
   - GDScript Coordinate, Forward, and Left/Right Conventions:
     * Forward is -Z: In Godot, \`Vector3.FORWARD\` is \`Vector3(0, 0, -1)\`. A 3D node's local forward direction is \`-transform.basis.z\` (or \`-global_transform.basis.z\`). In character movement, forward input (e.g., W or ui_up) must translate along \`-transform.basis.z\`. Never treat +Z as forward.
     * Backward is +Z: \`Vector3.BACK\` is \`Vector3(0, 0, 1)\` (\`transform.basis.z\`).
     * Right is +X: \`Vector3.RIGHT\` is \`Vector3(1, 0, 0)\` (\`transform.basis.x\`).
     * Left is -X: \`Vector3.LEFT\` is \`Vector3(-1, 0, 0)\` (\`-transform.basis.x\`).
     * Left/Right Convention in Godot Script: Maintain anatomical consistency in scripts—character Right is along +X (\`transform.basis.x\`) and character Left is along -X (\`-transform.basis.x\`).
     * Natural Model Alignment: Because OpenSCAD models face +Y (Forward), they automatically import facing Godot's Forward direction (-Z). Built-in Godot methods like \`look_at()\` orient the node's -Z axis toward the target, which perfectly aligns with the model's front. Do NOT apply compensation rotations (e.g., \`rotate_y(PI)\`) in GDScript to compensate for model orientation.
   - Generate a \`project.godot\` file. It must configure the project and automatically enable the \`scad_importer\` plugin.
   - Generate a \`.gitignore\` file that ignores the \`.godot/\` folder.
   - Generate a \`README.md\` file that documents the project, gameplay mechanics, and controls.

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using snake_case with underscores, e.g., \`my_game_project\`) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` game assets.
     - Your generated Godot project files.
     - The exact source code of the provided \`addons/scad_importer/*\` files, placed in their correct respective paths.${
       hasUserScadFiles
         ? "\n     - The exact source code of the provided user `.scad` files, placed in the appropriate project folders."
         : ""
     }
   - Ensure all string file contents inside the Node.js script are properly escaped.
   - TESTING CAPABILITY: You have access to the \`test_godot_project\` tool. If you want to verify your code before outputting your final response, you can pass your complete generated Node.js script as the \`nodejs_script\` parameter. The server will execute it in a temporary folder and run the Godot tests automatically.`;

  // 5. Gather Addon Files content
  const addonDir = path.join(DIR, "godot", "addons", "scad_importer");
  let addonFiles = [];
  try {
    if (fs.existsSync(addonDir)) {
      const files = fs.readdirSync(addonDir);
      for (const file of files) {
        const fullPath = path.join(addonDir, file);
        // Ensure we only read text files to prevent binary/hidden files
        // from introducing control characters that crash browser UIs.
        if (
          fs.statSync(fullPath).isFile() &&
          (file.endsWith(".gd") || file.endsWith(".cfg"))
        ) {
          addonFiles.push(fullPath);
        }
      }
    }
  } catch (e) {
    console.error("Warning: Could not read addon directory.", e);
  }

  // 6. Format the unified system instructions clipboard output
  let systemClipboardOutput = `${systemPrompt}\n\n`;

  for (const file of addonFiles) {
    try {
      // Normalize line endings to avoid mixed line-ending layout loops in web editors
      const content = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
      // Format to use relative paths and force forward slashes for LLM clarity
      const relativePath = path.relative(DIR, file).replace(/\\/g, "/");

      // Add explicit language tags to prevent catastrophic regex backtracking
      // during the Markdown parser's language auto-detection step.
      const lang = file.endsWith(".gd") ? "gdscript" : "text";
      systemClipboardOutput += `### ${relativePath}\n---\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
    } catch (e) {
      console.error(`Warning: Skipping '${file}'. It is not a readable file.`);
    }
  }

  if (hasUserScadFiles) {
    systemClipboardOutput += `=== USER PROVIDED OPENSCAD FILES ===\n`;
    systemClipboardOutput += `The following .scad files are provided as reference or base assets. You MUST embed and write them into the generated project, modifying them if necessary to fit the game logic.\n\n`;
    for (const file of options.scadFiles) {
      try {
        const content = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
        const relativePath = path.isAbsolute(file)
          ? path.relative(process.cwd(), file).replace(/\\/g, "/")
          : file.replace(/\\/g, "/");
        systemClipboardOutput += `### ${relativePath}\n---\n\`\`\`openscad\n${content}\n\`\`\`\n\n`;
      } catch (e) {
        console.error(
          `Warning: Skipping user SCAD file '${file}'. It is not a readable file.`,
        );
      }
    }
  }

  systemClipboardOutput = systemClipboardOutput.trimEnd() + "\n";

  // 7. Format the input request output
  const inputRequestOutput = `Design and implement a Godot 4 project for the following game concept: "${task}"`;

  // Check if API Key flow should be initialized instead of clipboard
  const apiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
  const geminiModel =
    options.geminiModel || process.env.GEMINI_MODEL || "gemini-flash-latest";
  if (apiKey) {
    await runAutomatedGeminiFlow(
      apiKey,
      geminiModel,
      systemClipboardOutput,
      inputRequestOutput,
      "generate_godot_project.js",
      ["render_scad_model", "test_godot_project"],
    );
    return;
  }

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
