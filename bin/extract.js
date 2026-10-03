#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  extractFilesFromMarkdown,
  writeExtractedFiles,
} from "../src/cli-utils.js";

const args = process.argv.slice(2);
const mdPath = args[0];
const outDir = args[1] || process.cwd();

if (!mdPath) {
  console.error(
    "❌ Error: Path to the generated Markdown project file is required.",
  );
  console.error("Usage: scad-gltf extract <project.md> [output_directory]");
  process.exit(1);
}

const absMdPath = path.resolve(process.cwd(), mdPath);
if (!fs.existsSync(absMdPath)) {
  console.error(`❌ Error: File not found: ${absMdPath}`);
  process.exit(1);
}

try {
  console.log(
    `📦 Extracting project files from ${path.basename(absMdPath)}...`,
  );

  const mdContent = fs.readFileSync(absMdPath, "utf-8");
  const files = extractFilesFromMarkdown(mdContent);
  const fileCount = Object.keys(files).length;

  if (fileCount === 0) {
    console.error("\n❌ Error: No files could be extracted.");
    console.error(
      "Make sure the Markdown uses '### filepath' headers followed by code blocks.",
    );
    process.exit(1);
  }

  const absOutDir = path.resolve(process.cwd(), outDir);
  writeExtractedFiles(files, absOutDir);

  console.log(
    `\n✅ Successfully extracted ${fileCount} file(s) to:\n   ${absOutDir}`,
  );
} catch (err) {
  console.error(`\n❌ Extraction failed: ${err.message}`);
  process.exit(1);
}
