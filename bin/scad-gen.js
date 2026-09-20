#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { generatePrompt } from "../src/prompt.js";
import {
  parseTaskAndOptions,
  writeToClipboard,
  waitForEnter,
  runAutomatedAIFlow,
} from "../src/cli-utils.js";

async function main() {
  const { task, optionsStr } = parseTaskAndOptions();

  if (!task) {
    console.error("Error: Task parameter is required.");
    console.error(
      'Usage: scad-gen "<description of the 3D model to generate>" [options_json]',
    );
    console.error('   or: echo "<description>" | scad-gen [options_json]');
    console.error("");
    console.error("Examples with JSON options (Automated AI flow):");
    console.error(
      '  scad-gen "A modular sci-fi corridor piece" \'{"openaiApiKey": "sk-...", "openaiModel": "gpt-4o"}\'',
    );
    console.error(
      '  scad-gen "A medieval longsword" \'{"openaiBaseUrl": "http://127.0.0.1:8080/v1", "openaiModel": "llama-3"}\'',
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

  // Check if API Key flows should be initialized
  const openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL;
  const openaiModel = options.openaiModel || process.env.OPENAI_MODEL;

  const isAutomated = !!(openaiApiKey || openaiBaseUrl);

  if (isAutomated) {
    // Filter out API settings
    const promptOptions = { ...options };
    delete promptOptions.openaiApiKey;
    delete promptOptions.openaiBaseUrl;
    delete promptOptions.openaiModel;

    let finalTaskPrompt = "";
    try {
      finalTaskPrompt = generatePrompt(task, promptOptions);
    } catch (e) {
      console.error("Error generating prompt rules from prompt.js:");
      console.error(e);
      process.exit(1);
    }

    const automatedSystemPrompt = `You are an expert procedural 3D technical artist and OpenSCAD developer.
Your goal is to generate a single OpenSCAD (.scad) file based on the user's request.

CRITICAL WORKFLOW:
1. Write the OpenSCAD code using the custom syntax rules provided in the request.
2. Call the \`render_scad_model\` tool with your code to visually verify your design.
3. If the model looks incorrect, adjust your code and re-render. Iterate until perfect.
4. Provide your final OpenSCAD code in a standard markdown block (\`\`\`openscad).`;

    await runAutomatedAIFlow(
      openaiApiKey,
      openaiBaseUrl,
      openaiModel,
      automatedSystemPrompt,
      finalTaskPrompt, // Pass the fully generated prompt here containing rules
      ["render_scad_model"],
      "scad", // Indicates we are directly generating a .scad file
    );
    return;
  }

  // --- Manual Clipboard Flow ---
  let finalPrompt = "";
  try {
    // get_scad_prompt/generatePrompt already includes the task description and all required instructions
    finalPrompt = generatePrompt(task, options);
  } catch (e) {
    console.error("Error generating prompt rules from prompt.js:");
    console.error(e);
    process.exit(1);
  }

  try {
    await writeToClipboard(finalPrompt);
    console.log(
      "✔️  Input request and syntax rules have been copied to the clipboard. You can now paste it into your LLM.",
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
