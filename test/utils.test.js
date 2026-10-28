import test from "node:test";
import assert from "node:assert";
import {
  extractFilesFromMarkdown,
  extractModelNameFromScad,
  extractScadDependencies,
} from "../src/utils.js";

test("utils - extractModelNameFromScad - standard format", () => {
  const code = "/* Model Name: Basic Model */\ncube(10);";
  const name = extractModelNameFromScad(code);
  assert.strictEqual(
    name,
    "Basic_Model",
    "Should extract and replace spaces with underscores",
  );
});

test("utils - extractModelNameFromScad - sanitization", () => {
  const code = "/*  model name:  My-Crazy_Model 123!@#  */";
  const name = extractModelNameFromScad(code);
  // Replaces spaces with underscores, strips non-alphanumeric (except dashes/underscores)
  assert.strictEqual(
    name,
    "My-Crazy_Model_123",
    "Should sanitize invalid filesystem characters",
  );
});

test("utils - extractModelNameFromScad - multiline and fallback", () => {
  const codeWithComments = `
// Some header comment
// Author: Test
/* Model Name: multiline_test */
sphere(10);
  `;
  assert.strictEqual(
    extractModelNameFromScad(codeWithComments),
    "multiline_test",
    "Should find the model name anywhere in the file",
  );

  const codeWithoutName = "cube(10); // Just a standard file";
  assert.strictEqual(
    extractModelNameFromScad(codeWithoutName),
    null,
    "Should return null if no block comment matches",
  );
});

test("utils - extractScadDependencies - standard includes and uses", () => {
  const code = `
    include <wheel.scad>
    use "engine.scad"

    module car() {
       wheel();
       engine();
    }
  `;
  const deps = extractScadDependencies(code);
  assert.deepStrictEqual(
    deps,
    ["wheel.scad", "engine.scad"],
    "Should extract both angled-bracket includes and quote uses",
  );
});

test("utils - extractScadDependencies - weird spacing and nested paths", () => {
  const code = `include<lib/parts/screw.scad>\nuse   "../another/file.scad"`;
  const deps = extractScadDependencies(code);
  assert.deepStrictEqual(
    deps,
    ["lib/parts/screw.scad", "../another/file.scad"],
    "Should handle lack of spaces and relative path syntax",
  );
});

test("utils - extractScadDependencies - no dependencies", () => {
  const code = "cube([10,10,10]);";
  const deps = extractScadDependencies(code);
  assert.deepStrictEqual(
    deps,
    [],
    "Should return an empty array when no imports exist",
  );
});

test("utils - extractFilesFromMarkdown - basic functionality", () => {
  const md = `
### my_file.js
\`\`\`js
const a = 1;
\`\`\`

### my_file2.scad
\`\`\`
cube(10);
\`\`\`
  `;

  const files = extractFilesFromMarkdown(md);
  assert.strictEqual(
    Object.keys(files).length,
    2,
    "Should extract exactly 2 files",
  );
  assert.strictEqual(files["my_file.js"].trim(), "const a = 1;");
  assert.strictEqual(files["my_file2.scad"].trim(), "cube(10);");
});

test("utils - extractFilesFromMarkdown - fallback behavior", () => {
  const md = `
Here is your raw SCAD file:
\`\`\`openscad
sphere(r=5);
\`\`\`
  `;

  const files = extractFilesFromMarkdown(md);
  assert.strictEqual(
    Object.keys(files).length,
    1,
    "Should fallback to exactly 1 file",
  );
  assert.strictEqual(
    files["main.scad"].trim(),
    "sphere(r=5);",
    "Should default to main.scad for raw blocks",
  );
});
