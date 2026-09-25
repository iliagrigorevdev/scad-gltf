#!/usr/bin/env node

import { runCliApp } from "../src/cli-utils.js";
import { getProjectPrompts } from "../src/project-prompts.js";

const VALID_TYPES = ["scad", "bevy", "wgpu", "web", "godot"];

async function main() {
  const projectType = process.argv[2];

  if (!projectType || !VALID_TYPES.includes(projectType)) {
    console.error(`Error: Invalid or missing project type.`);
    console.error(
      `Usage: scad-gltf gen <${VALID_TYPES.join("|")}> "<description>" [options_json]`,
    );
    console.error(
      `Example: scad-gltf gen godot "A 3D physics simulation" '{"openaiModel": "gpt-4o", "scadFiles": ["./player.scad"]}'`,
    );
    process.exit(1);
  }

  await runCliApp({
    projectType,
    ...getProjectPrompts(projectType),
    argStartIndex: 3, // Shift arg parsing right by 1 since projectType is at index 2
  });
}

// Execute and handle unhandled runtime errors
main().catch((err) => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
