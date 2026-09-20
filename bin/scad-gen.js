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

  // Parse Options JSON
  let options = {};
  if (optionsStr) {
    try {
      options = JSON.parse(optionsStr);
    } catch (e) {
      console.error(`Invalid JSON options: ${optionsStr}`);
      process.exit(1);
    }
  }

  // Check if API Key flows should be initialized
  const openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL;
  const openaiModel =
    options.openaiModel || process.env.OPENAI_MODEL || "gpt-4o";

  const isAutomated = !!(openaiApiKey || openaiBaseUrl);

  if (isAutomated) {
    // Filter out API settings so they aren't included in the tool call instruction
    const promptOptions = { ...options };
    delete promptOptions.openaiApiKey;
    delete promptOptions.openaiBaseUrl;
    delete promptOptions.openaiModel;
    const optionsJson = JSON.stringify(promptOptions);

    const automatedSystemPrompt = `You are an expert procedural 3D technical artist and OpenSCAD developer.
Your goal is to generate a single OpenSCAD (.scad) file based on the user's request.

CRITICAL WORKFLOW:
1. Call the \`get_scad_prompt\` tool with the user's description and the \`options\` parameter set to: ${optionsJson}. This returns the custom syntax rules for PBR materials, animations, and texture baking specific to this environment.
2. Write the OpenSCAD code using those rules.
3. Call the \`render_scad_model\` tool with your code to visually verify your design.
4. If the model looks incorrect, adjust your code and re-render. Iterate until perfect.
5. Provide your final OpenSCAD code in a standard markdown block (\`\`\`openscad).

Important Output Rules:
- Inside the code block, on the FIRST line, include a block comment with a concise filename in snake_case.
- Example: /* Model Name: your_model_name_here */`;

    await runAutomatedAIFlow(
      openaiApiKey,
      openaiBaseUrl,
      openaiModel,
      automatedSystemPrompt,
      task, // Just pass the raw task as the input request
      ["get_scad_prompt", "render_scad_model"],
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
