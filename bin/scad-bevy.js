#!/usr/bin/env node

import { runCliApp } from "../src/cli-utils.js";

async function main() {
  await runCliApp({
    appName: "scad-bevy",
    appDescription: "game",
    examples: [
      'scad-bevy "3D Space Shooter Game" \'{"openaiApiKey": "sk-...", "openaiModel": "gpt-4o"}\'',
      'scad-bevy "3D Platformer" \'{"openaiBaseUrl": "http://127.0.0.1:8080/v1", "openaiModel": "llama-3"}\'',
    ],
    promptTarget: "the 3D assets for the game",
    buildSystemPrompt: (
      promptRules,
    ) => `You are an expert Rust Bevy engine game developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.rs\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
1. 3D Game Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Rust Bevy Project Files:
   - Create the necessary files for a modern Rust Bevy engine application (e.g., \`Cargo.toml\`, \`build.rs\`, \`src/main.rs\`).
   - In \`Cargo.toml\`, include \`bevy\` as a dependency.
   - You MUST include this EXACT \`build.rs\` script at the root of the project to automatically compile the \`.scad\` files into \`.glb\` format inside the \`assets/models\` folder before running the game via Cargo:
     \`\`\`rust
     use std::process::Command;

     fn main() {
         // Tell Cargo to re-run this script only if the 'scad' directory changes
         println!("cargo::rerun-if-changed=scad");

         // Ensure cross-platform compatibility for npm global binaries
         let cmd = if cfg!(target_os = "windows") {
             "scad-convert.cmd"
         } else {
             "scad-convert"
         };

         let status = Command::new(cmd)
             .args(["./scad", "./assets/models", "--cache"])
             .status()
             .expect("Failed to execute scad-convert. Is scad-gltf installed globally?");

         if !status.success() {
             panic!("scad-convert failed with status: {}", status);
         }
     }
     \`\`\`
   - Write the core application logic in \`src/main.rs\` to load and display the converted \`.glb\` files interactively. Provide standard Bevy game systems (camera, lights, movement, etc.).

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using a slugified version of the project name) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` 3D assets.
     - Your generated Rust Bevy project files (\`Cargo.toml\`, \`build.rs\`, \`src/main.rs\`).
   - Ensure all string file contents inside the Node.js script are properly escaped.`,
    buildInputRequest: (task) =>
      `Design and implement a Rust Bevy engine game for the following concept: "${task}"`,
    allowedTools: ["render_scad_model", "compile_bevy_project"],
    projectType: "bevy",
  });
}

// Execute and handle unhandled runtime errors
main().catch((err) => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
