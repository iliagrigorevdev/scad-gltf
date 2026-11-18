import test from "node:test";
import assert from "node:assert";
import {
  extractRootFolderFromMarkdownFiles,
  isMarkdownContent,
  parseMdFileBlocks,
  findMdBlockAtCursor,
  isScadFilePath,
  analyzeMdLines,
  replaceFileInMarkdown,
} from "../editor/src/md-utils.js";

test("md-utils - extractRootFolderFromMarkdownFiles", () => {
  assert.strictEqual(
    extractRootFolderFromMarkdownFiles({
      "my_proj/main.scad": "",
      "/my_proj/sub/part.scad": "",
      "my_proj\\readme.md": "",
    }),
    "my_proj",
  );
  assert.strictEqual(
    extractRootFolderFromMarkdownFiles({
      "proj_a/a.scad": "",
      "proj_b/b.scad": "",
    }),
    null,
  );
  assert.strictEqual(
    extractRootFolderFromMarkdownFiles({ "main.scad": "" }),
    null,
  );
  assert.strictEqual(extractRootFolderFromMarkdownFiles({}), null);
});

test("md-utils - isMarkdownContent and isScadFilePath", () => {
  assert.strictEqual(
    isMarkdownContent("### main.scad\n```openscad\ncube(1);\n```"),
    true,
  );
  assert.strictEqual(isMarkdownContent("```scad\ncube(1);\n```"), true);
  assert.strictEqual(isMarkdownContent("```\ncube(1);\n```"), true);
  assert.strictEqual(isMarkdownContent("cube([10, 10, 10]);"), false);
  assert.strictEqual(isMarkdownContent(null), false);

  assert.strictEqual(isScadFilePath("models/Robot.SCAD"), true);
  assert.strictEqual(isScadFilePath("scripts/main.gd"), false);
  assert.strictEqual(isScadFilePath(null), false);
});

test("md-utils - parseMdFileBlocks and findMdBlockAtCursor", () => {
  const md = [
    "Intro text",
    "",
    "### part_a.scad",
    "```openscad",
    "cube(10);",
    "sphere(5);",
    "```",
    "",
    "### config.json",
    "```json",
    '{"ok": true}',
    "```",
  ].join("\n");

  const blocks = parseMdFileBlocks(md);
  assert.strictEqual(blocks.length, 2);

  assert.strictEqual(blocks[0].filePath, "part_a.scad");
  assert.strictEqual(
    md.slice(blocks[0].contentStart, blocks[0].contentEnd),
    "cube(10);\nsphere(5);",
  );

  assert.strictEqual(blocks[1].filePath, "config.json");
  assert.strictEqual(
    md.slice(blocks[1].contentStart, blocks[1].contentEnd),
    '{"ok": true}',
  );

  assert.strictEqual(findMdBlockAtCursor(md, 0), null);
  const insideFirst = findMdBlockAtCursor(md, blocks[0].contentStart + 2);
  assert.strictEqual(insideFirst.filePath, "part_a.scad");
  const onSecondHeader = findMdBlockAtCursor(md, blocks[1].headerStart);
  assert.strictEqual(onSecondHeader.filePath, "config.json");
});

test("md-utils - parseMdFileBlocks supports CRLF and generic fallback", () => {
  const crlfMd = "### a.scad\r\n```openscad\r\ncube(1);\r\n```\r\n";
  const blocks = parseMdFileBlocks(crlfMd);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(
    crlfMd.slice(blocks[0].contentStart, blocks[0].contentEnd),
    "cube(1);",
  );

  const genericMd = "Here is code:\n```openscad\n  sphere(4);\n```\n";
  const genericBlocks = parseMdFileBlocks(genericMd);
  assert.strictEqual(genericBlocks.length, 1);
  assert.strictEqual(genericBlocks[0].filePath, "main.scad");
  assert.strictEqual(
    genericMd.slice(genericBlocks[0].contentStart, genericBlocks[0].contentEnd),
    "sphere(4);",
  );
});

test("md-utils - analyzeMdLines classifies headers, fences, bodies, and plain lines", () => {
  const md = [
    "Some explanation",
    "### main.scad",
    "Optional preamble",
    "```openscad",
    "cube(5);",
    "```",
    "### data.json",
    "```json",
    "{}",
    "```",
    "```openscad",
    "sphere(2);",
    "```",
  ].join("\n");

  const { parsed, hasFileBlocks } = analyzeMdLines(md);
  assert.strictEqual(hasFileBlocks, true);
  assert.strictEqual(parsed[0].role, "plain");
  assert.strictEqual(parsed[0].blockIdx, -1);

  assert.deepStrictEqual(
    {
      role: parsed[1].role,
      blockIdx: parsed[1].blockIdx,
      filePath: parsed[1].filePath,
      isScad: parsed[1].isScad,
    },
    { role: "header", blockIdx: 0, filePath: "main.scad", isScad: true },
  );
  assert.strictEqual(parsed[2].role, "preamble");
  assert.strictEqual(parsed[3].role, "fence-open");
  assert.strictEqual(parsed[4].role, "body");
  assert.strictEqual(parsed[5].role, "fence-close");

  assert.strictEqual(parsed[6].blockIdx, 1);
  assert.strictEqual(parsed[6].isScad, false);
  assert.strictEqual(parsed[8].role, "body");
  assert.strictEqual(parsed[8].isScad, false);

  assert.strictEqual(parsed[10].role, "fence-open");
  assert.strictEqual(parsed[10].filePath, "main.scad");
  assert.strictEqual(parsed[10].isScad, true);
  assert.strictEqual(parsed[11].role, "body");
  assert.strictEqual(parsed[12].role, "fence-close");

  const plainOnly = analyzeMdLines("cube(10);\nsphere(5);");
  assert.strictEqual(plainOnly.hasFileBlocks, false);
});

test("md-utils - replaceFileInMarkdown replaces existing, generic, and missing entries", () => {
  const md = [
    "### a.scad",
    "```openscad",
    "cube(1);",
    "```",
    "",
    "### b.gd",
    "```gdscript",
    "extends Node",
    "```",
  ].join("\n");

  const replaced = replaceFileInMarkdown(md, "a.scad", "sphere(2);\ncube(3);");
  assert.ok(replaced.includes("```openscad\nsphere(2);\ncube(3);\n```"));
  assert.ok(replaced.includes("### b.gd\n```gdscript\nextends Node\n```"));

  const cleared = replaceFileInMarkdown(md, "a.scad", "");
  assert.ok(cleared.includes("### a.scad\n```openscad\n```"));

  const appended = replaceFileInMarkdown(
    md,
    "scripts/new.gd",
    "extends Node3D",
  );
  assert.ok(
    appended.endsWith("### scripts/new.gd\n```gdscript\nextends Node3D\n```\n"),
  );

  const genericMd = "```openscad\ncube(1);\n```";
  const genericReplaced = replaceFileInMarkdown(
    genericMd,
    "main.scad",
    "cylinder(r=2, h=4);",
  );
  assert.strictEqual(genericReplaced, "```openscad\ncylinder(r=2, h=4);\n```");
});

test("md-utils - matches and patches backtick-wrapped file headers", () => {
  const existingMd = [
    "### scrap_scale/scenes/main_game.tscn",
    "```ini",
    "[gd_scene format=3]",
    "```",
  ].join("\n");

  const patched = replaceFileInMarkdown(
    existingMd,
    "`scrap_scale/scenes/main_game.tscn`",
    '[gd_scene format=3]\n[node name="Main" type="Node3D"]',
  );
  assert.strictEqual(
    patched,
    [
      "### scrap_scale/scenes/main_game.tscn",
      "```ini",
      "[gd_scene format=3]",
      '[node name="Main" type="Node3D"]',
      "```",
    ].join("\n"),
  );

  const backtickedMd = [
    "### `scrap_scale/scenes/main_game.tscn`",
    "```ini",
    "old",
    "```",
  ].join("\n");
  const blocks = parseMdFileBlocks(backtickedMd);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].filePath, "scrap_scale/scenes/main_game.tscn");

  const { parsed } = analyzeMdLines(backtickedMd);
  assert.strictEqual(parsed[0].filePath, "scrap_scale/scenes/main_game.tscn");

  const patchedBackticked = replaceFileInMarkdown(
    backtickedMd,
    "scrap_scale/scenes/main_game.tscn",
    "new",
  );
  assert.strictEqual(
    patchedBackticked,
    ["### `scrap_scale/scenes/main_game.tscn`", "```ini", "new", "```"].join(
      "\n",
    ),
  );
});
