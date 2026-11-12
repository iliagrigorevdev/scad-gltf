import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  packFilesToMarkdown,
  extractFilesFromMarkdown,
  getMarkdownLangFromPath,
} from "../src/utils.js";
import { collectFilesFromDirectory } from "../src/cli-utils.js";

test("getMarkdownLangFromPath - Maps common extensions", () => {
  assert.strictEqual(getMarkdownLangFromPath("models/car.scad"), "openscad");
  assert.strictEqual(getMarkdownLangFromPath("src/main.rs"), "rust");
  assert.strictEqual(getMarkdownLangFromPath("scripts/player.gd"), "gdscript");
  assert.strictEqual(getMarkdownLangFromPath(".gitignore"), "text");
  assert.strictEqual(getMarkdownLangFromPath("README"), "text");
});

test("packFilesToMarkdown - Round-trips cleanly with extractFilesFromMarkdown", () => {
  const inputFiles = {
    "my_project/src/main.js": 'console.log("hello");',
    "my_project/models/box.scad": "cube([10, 10, 10]);\n",
  };

  const md = packFilesToMarkdown(inputFiles);
  const extracted = extractFilesFromMarkdown(md);

  assert.deepStrictEqual(extracted, inputFiles);
});

test("collectFilesFromDirectory - Collects text files and skips ignored/binary files", () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "scad-pack-dir-"));
  const projectDir = path.join(tempBase, "sample_proj");

  try {
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "node_modules", "pkg"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(projectDir, ".git"), { recursive: true });

    fs.writeFileSync(path.join(projectDir, "package.json"), '{"name":"a"}');
    fs.writeFileSync(path.join(projectDir, "src", "cube.scad"), "cube(5);\r\n");
    fs.writeFileSync(
      path.join(projectDir, "node_modules", "pkg", "index.js"),
      "ignored",
    );
    fs.writeFileSync(path.join(projectDir, ".git", "HEAD"), "ignored");
    fs.writeFileSync(
      path.join(projectDir, "bin.dat"),
      Buffer.from([0x00, 0x01, 0x02]),
    );

    const outPath = path.join(projectDir, "sample_proj.md");
    fs.writeFileSync(outPath, "old output");

    const { files, skippedBinary } = collectFilesFromDirectory(projectDir, {
      excludePath: outPath,
    });

    assert.deepStrictEqual(Object.keys(files), [
      "sample_proj/package.json",
      "sample_proj/src/cube.scad",
    ]);
    assert.strictEqual(files["sample_proj/src/cube.scad"], "cube(5);\n");
    assert.deepStrictEqual(skippedBinary, ["sample_proj/bin.dat"]);

    const { files: flatFiles } = collectFilesFromDirectory(projectDir, {
      includeRoot: false,
      excludePath: outPath,
    });
    assert.deepStrictEqual(Object.keys(flatFiles), [
      "package.json",
      "src/cube.scad",
    ]);
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
});
