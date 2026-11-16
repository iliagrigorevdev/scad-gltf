import test from "node:test";
import assert from "node:assert";
import {
  hashString,
  getUtf8ByteLength,
  formatBytes,
  isMultiFileMarkdown,
  getContentFileMap,
  computeLineDiff,
  buildUnifiedDisplayItems,
  buildSideBySideRows,
  extractScadEntries,
  resolveScadCompilationInput,
} from "../editor/src/diff-utils.js";

test("diff-utils - formatting and hashing helpers", () => {
  assert.strictEqual(formatBytes(500), "500 B");
  assert.strictEqual(formatBytes(2048), "2.0 KB");
  assert.strictEqual(formatBytes(2 * 1024 * 1024), "2.00 MB");

  assert.strictEqual(getUtf8ByteLength("abc"), 3);
  assert.strictEqual(getUtf8ByteLength("🚀"), 4);

  assert.strictEqual(hashString("abc"), hashString("abc"));
  assert.notStrictEqual(hashString("abc"), hashString("abd"));
});

test("diff-utils - computeLineDiff handles identical, empty, middle edits, and CRLF", () => {
  const same = computeLineDiff("a\r\nb\r\nc", "a\nb\nc");
  assert.strictEqual(same.added, 0);
  assert.strictEqual(same.removed, 0);
  assert.strictEqual(same.unchanged, 3);

  const fromEmpty = computeLineDiff("", "line1\nline2");
  assert.strictEqual(fromEmpty.added, 2);
  assert.strictEqual(fromEmpty.removed, 0);

  const toEmpty = computeLineDiff("line1\nline2", "");
  assert.strictEqual(toEmpty.added, 0);
  assert.strictEqual(toEmpty.removed, 2);

  const mid = computeLineDiff(
    "header\nold1\nold2\nfooter",
    "header\nnew1\nfooter",
  );
  assert.strictEqual(mid.unchanged, 2);
  assert.strictEqual(mid.removed, 2);
  assert.strictEqual(mid.added, 1);
  assert.deepStrictEqual(
    mid.ops.map((o) => [o.type, o.text]),
    [
      ["equal", "header"],
      ["remove", "old1"],
      ["remove", "old2"],
      ["add", "new1"],
      ["equal", "footer"],
    ],
  );
});

test("diff-utils - computeLineDiff large delta lookahead fallback preserves reconstruction", () => {
  // Middle region > 1_000_000 (1050 * 1050) triggers greedy lookahead fallback
  const linesA = [];
  const linesB = [];
  for (let i = 0; i < 1050; i++) {
    linesA.push(`a_${i}`);
    linesB.push(i % 10 === 0 ? `a_${i}` : `b_${i}`);
  }
  const diff = computeLineDiff(linesA.join("\n"), linesB.join("\n"));
  const reconstructedA = diff.ops
    .filter((o) => o.type !== "add")
    .map((o) => o.text);
  const reconstructedB = diff.ops
    .filter((o) => o.type !== "remove")
    .map((o) => o.text);

  assert.deepStrictEqual(reconstructedA, linesA);
  assert.deepStrictEqual(reconstructedB, linesB);
  assert.ok(diff.unchanged >= 105);
});

test("diff-utils - buildUnifiedDisplayItems and buildSideBySideRows collapse context hunks", () => {
  const linesA = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const linesB = [...linesA];
  linesB[10] = "line 11 changed";

  const diff = computeLineDiff(linesA.join("\n"), linesB.join("\n"));

  const fullUnified = buildUnifiedDisplayItems(diff.ops, true);
  assert.strictEqual(fullUnified.length, diff.ops.length);
  assert.ok(!fullUnified.some((item) => item.type === "hunk"));

  const compactUnified = buildUnifiedDisplayItems(diff.ops, false);
  assert.strictEqual(compactUnified[0].type, "hunk");
  assert.strictEqual(compactUnified[0].skipped, 7);
  assert.strictEqual(compactUnified[compactUnified.length - 1].type, "hunk");
  assert.strictEqual(compactUnified[compactUnified.length - 1].skipped, 6);

  const compactSplit = buildSideBySideRows(diff.ops, false);
  assert.strictEqual(compactSplit[0].type, "hunk");
  const changeRow = compactSplit.find((r) => r.type === "change");
  assert.strictEqual(changeRow.left.type, "remove");
  assert.strictEqual(changeRow.left.text, "line 11");
  assert.strictEqual(changeRow.right.type, "add");
  assert.strictEqual(changeRow.right.text, "line 11 changed");
});

test("diff-utils - extractScadEntries and resolveScadCompilationInput", () => {
  assert.strictEqual(isMultiFileMarkdown("cube(1);"), false);
  assert.strictEqual(getContentFileMap("cube(1);"), null);

  const raw = resolveScadCompilationInput("cube(10);", null);
  assert.strictEqual(raw.entryCode, "cube(10);");
  assert.deepStrictEqual(raw.extractedAdditionalFiles, {});
  assert.strictEqual(raw.targetScadPath, null);

  const md = [
    "### lib/utils.scad",
    "```openscad",
    "module box() { cube(1); }",
    "```",
    "### main.scad",
    "```openscad",
    "include <lib/utils.scad>\nbox();",
    "```",
    "### readme.txt",
    "```text",
    "hello",
    "```",
  ].join("\n");

  assert.strictEqual(isMultiFileMarkdown(md), true);
  const entries = extractScadEntries(md);
  assert.strictEqual(entries.isMd, true);
  assert.deepStrictEqual(entries.scadFiles, ["lib/utils.scad", "main.scad"]);

  const resolved = resolveScadCompilationInput(md, "main.scad");
  assert.strictEqual(resolved.targetScadPath, "main.scad");
  assert.strictEqual(resolved.entryCode, "include <lib/utils.scad>\nbox();");
  assert.deepStrictEqual(resolved.extractedAdditionalFiles, {
    "lib/utils.scad": "module box() { cube(1); }",
    "readme.txt": "hello",
  });

  const generic = resolveScadCompilationInput("```openscad\nsphere(3);\n```");
  assert.strictEqual(generic.targetScadPath, "main.scad");
  assert.strictEqual(generic.entryCode, "sphere(3);");
});
