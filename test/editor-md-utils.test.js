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
  removeFileFromMarkdown,
  parseSearchReplaceBlocks,
  applySearchReplaceHunks,
  parseMarkdownPatchEntries,
  resolveMarkdownPatchTarget,
  evaluatePatchEntryAgainstFiles,
  analyzeMarkdownPatch,
  applyMarkdownPatchPlan,
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

test("md-utils - supports tilde and multi-backtick fences in parseMdFileBlocks, analyzeMdLines, and replaceFileInMarkdown", () => {
  const md = [
    "### docs/note.md",
    "~~~~markdown",
    "```scad",
    "cube(1);",
    "```",
    "~~~~",
  ].join("\n");

  const blocks = parseMdFileBlocks(md);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].filePath, "docs/note.md");
  assert.strictEqual(
    md.slice(blocks[0].contentStart, blocks[0].contentEnd),
    "```scad\ncube(1);\n```",
  );

  const { parsed, hasFileBlocks } = analyzeMdLines(md);
  assert.strictEqual(hasFileBlocks, true);
  assert.strictEqual(parsed[1].role, "fence-open");
  assert.strictEqual(parsed[3].role, "body");
  assert.strictEqual(parsed[5].role, "fence-close");

  const upgraded = replaceFileInMarkdown(
    "### docs/note.md\n```markdown\nplain\n```",
    "docs/note.md",
    "```js\nhello()\n```",
  );
  assert.ok(upgraded.includes("````markdown\n```js\nhello()\n```\n````"));
});

test("md-utils - removeFileFromMarkdown removes first, middle, last, only, and missing files", () => {
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
    "",
    "### c.txt",
    "```text",
    "hi",
    "```",
  ].join("\n");

  const noMiddle = removeFileFromMarkdown(md, "b.gd");
  assert.ok(!noMiddle.includes("### b.gd"));
  assert.ok(noMiddle.includes("### a.scad"));
  assert.ok(noMiddle.includes("### c.txt"));

  const noFirst = removeFileFromMarkdown(noMiddle, "a.scad");
  assert.strictEqual(noFirst, "### c.txt\n```text\nhi\n```");

  const noLast = removeFileFromMarkdown(noFirst, "c.txt");
  assert.strictEqual(noLast, "");

  assert.strictEqual(removeFileFromMarkdown(md, "missing.txt"), md);
});

test("md-utils - parseSearchReplaceBlocks and applySearchReplaceHunks", () => {
  const patchBody = [
    "<<<<<<< SEARCH",
    "let x = 1;",
    "=======",
    "let x = 2;",
    ">>>>>>> REPLACE",
    "",
    "<<<<<<< SEARCH",
    "return x;   ",
    "=======",
    "return x * 2;",
    ">>>>>>> REPLACE",
  ].join("\n");

  const hunks = parseSearchReplaceBlocks(patchBody);
  assert.strictEqual(hunks.length, 2);

  const applied = applySearchReplaceHunks(
    "function f() {\nlet x = 1;\nreturn x;\n}",
    hunks,
  );
  assert.deepStrictEqual(applied.errors, []);
  assert.strictEqual(
    applied.content,
    "function f() {\nlet x = 2;\nreturn x * 2;\n}",
  );

  const missing = applySearchReplaceHunks("other()", hunks);
  assert.strictEqual(missing.errors.length, 2);

  // Unclosed SEARCH block returns null from parseSearchReplaceBlocks
  assert.strictEqual(
    parseSearchReplaceBlocks("<<<<<<< SEARCH\nfoo\n=======\nbar"),
    null,
  );
});

test("md-utils - parseMarkdownPatchEntries handles updates, deletes, SEARCH/REPLACE, and malformed hunks", () => {
  const patch = [
    "Here is prose:",
    "```markdown",
    "### ignored/inside_prose.gd",
    "```",
    "",
    "### scripts/player.gd",
    "```gdscript",
    "<<<<<<< SEARCH",
    "speed = 5",
    "=======",
    "speed = 10",
    ">>>>>>> REPLACE",
    "```",
    "",
    "### old/unused.scad (DELETE)",
    "",
    "### DELETE: old/second.txt",
    "```text",
    "<!-- DELETE -->",
    "```",
    "",
    "### broken/hunk.gd",
    "```gdscript",
    "<<<<<<< SEARCH",
    "missing_end",
    "```",
  ].join("\n");

  const entries = parseMarkdownPatchEntries(patch);
  assert.strictEqual(entries.length, 4);
  assert.strictEqual(entries[0].filePath, "scripts/player.gd");
  assert.strictEqual(entries[0].hunks.length, 1);
  assert.strictEqual(entries[1].filePath, "old/unused.scad");
  assert.strictEqual(entries[1].isDelete, true);
  assert.strictEqual(entries[2].filePath, "old/second.txt");
  assert.strictEqual(entries[2].isDelete, true);
  assert.strictEqual(entries[3].filePath, "broken/hunk.gd");
  assert.strictEqual(entries[3].hasMalformedHunks, true);
});

test("md-utils - resolveMarkdownPatchTarget resolves root prefixes, swapped roots, suffixes, basenames, and new paths", () => {
  const existing = [
    "my_game/project.godot",
    "my_game/scripts/player.gd",
    "my_game/models/ship.scad",
    "my_game/a/shared.gd",
    "my_game/b/shared.gd",
  ];

  assert.deepStrictEqual(
    resolveMarkdownPatchTarget(existing, "scripts/player.gd", "my_game"),
    {
      resolvedPath: "my_game/scripts/player.gd",
      matchedExisting: true,
      remappedFrom: "scripts/player.gd",
    },
  );

  // Swapped root folder
  assert.deepStrictEqual(
    resolveMarkdownPatchTarget(
      existing,
      "other_root/models/ship.scad",
      "my_game",
    ),
    {
      resolvedPath: "my_game/models/ship.scad",
      matchedExisting: true,
      remappedFrom: "other_root/models/ship.scad",
    },
  );

  // Unique basename match
  assert.deepStrictEqual(
    resolveMarkdownPatchTarget(existing, "player.gd", "my_game"),
    {
      resolvedPath: "my_game/scripts/player.gd",
      matchedExisting: true,
      remappedFrom: "player.gd",
    },
  );

  // Ambiguous basename falls back to placing under rootFolder as new file
  assert.deepStrictEqual(
    resolveMarkdownPatchTarget(existing, "shared.gd", "my_game"),
    {
      resolvedPath: "my_game/shared.gd",
      matchedExisting: false,
      remappedFrom: "shared.gd",
    },
  );

  // New file placed under rootFolder
  assert.deepStrictEqual(
    resolveMarkdownPatchTarget(existing, "scripts/enemy.gd", "my_game"),
    {
      resolvedPath: "my_game/scripts/enemy.gd",
      matchedExisting: false,
      remappedFrom: "scripts/enemy.gd",
    },
  );
});

test("md-utils - evaluatePatchEntryAgainstFiles, analyzeMarkdownPatch, and applyMarkdownPatchPlan", () => {
  const existingMd = [
    "### my_game/project.godot",
    "```ini",
    "config_version=5",
    "```",
    "",
    "### my_game/scripts/player.gd",
    "```gdscript",
    "var speed = 5",
    "```",
    "",
    "### my_game/obsolete.txt",
    "```text",
    "old",
    "```",
  ].join("\n");

  const patchText = [
    "### scripts/player.gd",
    "```gdscript",
    "<<<<<<< SEARCH",
    "var speed = 5",
    "=======",
    "var speed = 12",
    ">>>>>>> REPLACE",
    "```",
    "",
    "### scripts/enemy.gd",
    "```gdscript",
    "extends Node3D",
    "```",
    "",
    "### obsolete.txt (DELETE)",
  ].join("\n");

  const analysis = analyzeMarkdownPatch(existingMd, patchText);
  assert.strictEqual(analysis.isLikelyFullProjectReplacement, false);
  assert.strictEqual(analysis.matchedCount, 2);
  assert.deepStrictEqual(
    analysis.items.map((i) => [i.action, i.targetPath, i.enabled]),
    [
      ["update", "my_game/scripts/player.gd", true],
      ["add", "my_game/scripts/enemy.gd", true],
      ["delete", "my_game/obsolete.txt", true],
    ],
  );

  const { updatedMd, appliedItems } = applyMarkdownPatchPlan(
    existingMd,
    analysis.items,
  );
  assert.strictEqual(appliedItems.length, 3);
  assert.ok(updatedMd.includes("var speed = 12"));
  assert.ok(updatedMd.includes("### my_game/scripts/enemy.gd"));
  assert.ok(!updatedMd.includes("### my_game/obsolete.txt"));

  // Malformed SEARCH/REPLACE results in error action and disabled item
  const malformedEval = evaluatePatchEntryAgainstFiles(
    {
      filePath: "my_game/scripts/player.gd",
      isDelete: false,
      content: "<<<<<<< SEARCH\nx",
      hunks: null,
      hasMalformedHunks: true,
    },
    "my_game/scripts/player.gd",
    { "my_game/scripts/player.gd": "var speed = 5" },
  );
  assert.strictEqual(malformedEval.action, "error");
  assert.strictEqual(malformedEval.enabled, false);

  // Full project replacement detection when unmatched project.godot + >= 2 files
  const fullReplaceAnalysis = analyzeMarkdownPatch(
    "### old_proj/main.scad\n```openscad\ncube(1);\n```",
    "### new_proj/project.godot\n```ini\nconfig_version=5\n```\n### new_proj/main.gd\n```gdscript\nextends Node\n```",
  );
  assert.strictEqual(fullReplaceAnalysis.isLikelyFullProjectReplacement, true);
});

test("md-utils - parseMarkdownPatchEntries and analyzeMarkdownPatch handle numbered and annotated AI headers", () => {
  const existingMd = [
    "### canyon_push_game/project.godot",
    "```ini",
    "config_version=5",
    "```",
    "",
    "### canyon_push_game/scripts/player_controller.gd",
    "```gdscript",
    "extends CharacterBody3D",
    "```",
    "",
    "### canyon_push_game/old_helper.gd",
    "```gdscript",
    "extends Node",
    "```",
  ].join("\n");

  const patchText = [
    "Here is the complete `sound_manager.gd` along with updates.",
    "",
    "### 1. Summary of changes (not a file)",
    "Some explanatory prose.",
    "",
    "### 1. `canyon_push_game/scripts/sound_manager.gd` (new file)",
    "```gdscript",
    "extends Node",
    "```",
    "",
    "### 2. `canyon_push_game/project.godot` (add `[autoload]` section)",
    "Add this section:",
    "```ini",
    "[autoload]",
    'SoundManager="*res://scripts/sound_manager.gd"',
    "```",
    "",
    "### 3. `canyon_push_game/scripts/player_controller.gd`",
    "Updated to play footsteps:",
    "```gdscript",
    "extends CharacterBody3D",
    "func _ready(): pass",
    "```",
    "",
    "### 4. `canyon_push_game/old_helper.gd` (DELETE)",
  ].join("\n");

  const entries = parseMarkdownPatchEntries(patchText);
  assert.deepStrictEqual(
    entries.map((e) => [e.filePath, e.isDelete]),
    [
      ["canyon_push_game/scripts/sound_manager.gd", false],
      ["canyon_push_game/project.godot", false],
      ["canyon_push_game/scripts/player_controller.gd", false],
      ["canyon_push_game/old_helper.gd", true],
    ],
  );

  const analysis = analyzeMarkdownPatch(existingMd, patchText);
  assert.strictEqual(analysis.isLikelyFullProjectReplacement, false);
  assert.deepStrictEqual(
    analysis.items.map((i) => [i.action, i.targetPath, i.enabled]),
    [
      ["add", "canyon_push_game/scripts/sound_manager.gd", true],
      ["update", "canyon_push_game/project.godot", true],
      ["update", "canyon_push_game/scripts/player_controller.gd", true],
      ["delete", "canyon_push_game/old_helper.gd", true],
    ],
  );
});
