#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { collectFilesFromDirectory } from "../src/cli-utils.js";
import { packFilesToMarkdown } from "../src/utils.js";

const allArgs = process.argv.slice(2);
const noRoot = allArgs.includes("--no-root");
const args = allArgs.filter((arg) => arg !== "--no-root");

const inputDir = args[0];
const outArg = args[1];

if (!inputDir) {
  console.error("❌ Error: Path to the input directory is required.");
  console.error(
    "Usage: scad-gltf pack <input_directory> [output.md] [--no-root]",
  );
  process.exit(1);
}

const absInputDir = path.resolve(process.cwd(), inputDir);
if (!fs.existsSync(absInputDir) || !fs.statSync(absInputDir).isDirectory()) {
  console.error(`❌ Error: Directory not found: ${absInputDir}`);
  process.exit(1);
}

const folderName = path.basename(absInputDir);
let absOutPath;
if (outArg) {
  const resolvedOut = path.resolve(process.cwd(), outArg);
  if (fs.existsSync(resolvedOut) && fs.statSync(resolvedOut).isDirectory()) {
    absOutPath = path.join(resolvedOut, `${folderName}.md`);
  } else {
    absOutPath = resolvedOut;
  }
} else {
  absOutPath = path.resolve(process.cwd(), `${folderName}.md`);
}

try {
  console.log(`📦 Packing files from ${absInputDir}...`);

  const { files, skippedBinary, skippedInvalidPath } =
    collectFilesFromDirectory(absInputDir, {
      includeRoot: !noRoot,
      excludePath: absOutPath,
    });

  const fileCount = Object.keys(files).length;

  if (fileCount === 0) {
    console.error("\n❌ Error: No packable text files were found.");
    process.exit(1);
  }

  if (skippedBinary.length > 0) {
    console.log(
      `⚠️  Skipped ${skippedBinary.length} binary file(s): ${skippedBinary.join(", ")}`,
    );
  }

  if (skippedInvalidPath.length > 0) {
    console.log(
      `⚠️  Skipped ${skippedInvalidPath.length} file(s) with whitespace in path: ${skippedInvalidPath.join(", ")}`,
    );
  }

  const mdContent = packFilesToMarkdown(files);

  fs.mkdirSync(path.dirname(absOutPath), { recursive: true });
  fs.writeFileSync(absOutPath, mdContent, "utf-8");

  console.log(
    `\n✅ Successfully packed ${fileCount} file(s) to:\n   ${absOutPath}`,
  );
} catch (err) {
  console.error(`\n❌ Packing failed: ${err.message}`);
  process.exit(1);
}
