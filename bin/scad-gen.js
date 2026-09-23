#!/usr/bin/env node

import { runCliApp } from "../src/cli-utils.js";

async function main() {
  await runCliApp({
    projectType: "gen",
    buildSystemPrompt: () =>
      `You are an expert procedural 3D technical artist and OpenSCAD developer.
Your goal is to generate a single OpenSCAD (.scad) file based on the user's request.

CRITICAL WORKFLOW:
1. Write the OpenSCAD code using the custom syntax rules provided in the request.
2. Call the \`render_scad_model\` tool with your code to visually verify your design.
3. If the model looks incorrect, adjust your code and re-render. Iterate until perfect.
4. Provide your final OpenSCAD code in a standard markdown block (\`\`\`openscad).`,
    allowedTools: ["render_scad_model"],
  });
}

// Execute and handle unhandled runtime errors
main().catch((err) => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
