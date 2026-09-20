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
  runAutomatedOpenAIFlow,
} from "../src/cli-utils.js";

async function main() {
  const { task, optionsStr } = parseTaskAndOptions();

  if (!task) {
    console.error("Error: Task parameter is required.");
    console.error(
      'Usage: scad-web "<description of the web app to generate>" [options_json]',
    );
    console.error('   or: echo "<description>" | scad-web [options_json]');
    console.error("");
    console.error("Examples with JSON options (Automated AI flow):");
    console.error(
      '  scad-web "3D Car Configurator Web App" \'{"geminiApiKey": "AIzaSy...", "geminiModel": "gemini-3.8-flash"}\'',
    );
    console.error(
      '  scad-web "3D Car Configurator Web App" \'{"openaiBaseUrl": "http://127.0.0.1:8080/v1", "openaiModel": "llama-3"}\'',
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
   - Ensure all string file contents inside the Node.js script are properly escaped.`;

  // 5. Format the input request output
  const inputRequestOutput = `Design and implement a web-based 3D glTF app using Vite for the following concept: "${task}"`;

  // Check if API Key flows should be initialized instead of manual clipboard
  const geminiApiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
  const geminiModel =
    options.geminiModel || process.env.GEMINI_MODEL || "gemini-flash-latest";

  const openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL;
  const openaiModel =
    options.openaiModel || process.env.OPENAI_MODEL || "gpt-4o";

  if (openaiApiKey || openaiBaseUrl) {
    await runAutomatedOpenAIFlow(
      openaiApiKey,
      openaiBaseUrl,
      openaiModel,
      systemPrompt,
      inputRequestOutput,
      ["render_scad_model"],
      "web",
    );
    return;
  } else if (geminiApiKey) {
    await runAutomatedGeminiFlow(
      geminiApiKey,
      geminiModel,
      systemPrompt,
      inputRequestOutput,
      ["render_scad_model"],
      "web",
    );
    return;
  }

  // 6. Write to System Clipboard (Part 1: System Instructions)
  try {
    await writeToClipboard(systemPrompt);
    console.log("✔️  System instructions have been copied to the clipboard.");
  } catch (err) {
    console.error(
      "Error: Failed to copy system instructions to the clipboard.",
    );
    console.error(err.message);
    process.exit(1);
  }

  // 7. Await user confirmation
  await waitForEnter(
    "Please paste the system instructions into your LLM, then press ENTER to copy your input request...",
  );

  // 8. Write to System Clipboard (Part 2: Input Request)
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
