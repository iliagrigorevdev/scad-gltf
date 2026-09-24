#!/usr/bin/env node

const command = process.argv[2];

const commands = {
  convert: "./convert.js",
  serve: "./serve.js",
  mcp: "./mcp.js",
  gen: "./gen.js",
  play: "./play.js",
};

if (!command || !commands[command]) {
  console.error("Usage: scad-gltf <command> [options]");
  console.error("\nAvailable commands:");
  console.error("  convert   Convert .scad files to .glb binaries");
  console.error("  serve     Start local API server and Web Editor");
  console.error("  mcp       Start the Model Context Protocol (MCP) server");
  console.error(
    "  gen       Automated AI generation of 3D models and game projects",
  );
  console.error("  play      Test and launch generated Node.js scripts");
  process.exit(1);
}

// Remove the subcommand from argv so the delegated scripts parse indices exactly as they did before
process.argv.splice(2, 1);

// Dynamically import the requested command script
import(commands[command]).catch((err) => {
  console.error(`Failed to execute command '${command}':`, err);
  process.exit(1);
});
