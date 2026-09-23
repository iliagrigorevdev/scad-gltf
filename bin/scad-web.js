#!/usr/bin/env node

import { runCliApp } from "../src/cli-utils.js";

async function main() {
  await runCliApp({
    appName: "scad-web",
    appDescription: "web app",
    examples: [
      'scad-web "3D Car Configurator Web App" \'{"openaiApiKey": "sk-...", "openaiModel": "gpt-4o"}\'',
      'scad-web "3D Car Configurator Web App" \'{"openaiBaseUrl": "http://127.0.0.1:8080/v1", "openaiModel": "llama-3"}\'',
    ],
    promptTarget: "the 3D assets for the web app",
    buildSystemPrompt: (
      promptRules,
    ) => `You are an expert Web 3D developer and procedural 3D technical artist.

What to generate:
1. 3D Web Assets (.scad):
   - Generate procedural 3D models for the web app using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Vite Web Project Files (npm based):
   - Create the necessary files for a modern web application (e.g., \`package.json\`, \`index.html\`, \`main.js\`).
   - You can use ANY web 3D library with glTF support (e.g., Three.js, Babylon.js, @google/model-viewer, PlayCanvas, A-Frame, etc.) that fits the app's requirements.
   - In \`package.json\`, you MUST include the scad to gltf converter tool as a dev dependency:
     \`"scad-gltf": "^0.1.0"\`
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
   - Ensure all string file contents inside the Node.js script are properly escaped.`,
    buildInputRequest: (task) =>
      `Design and implement a web-based 3D glTF app using Vite for the following concept: "${task}"`,
    allowedTools: ["render_scad_model"],
    projectType: "web",
  });
}

// Execute and handle unhandled runtime errors
main().catch((err) => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
