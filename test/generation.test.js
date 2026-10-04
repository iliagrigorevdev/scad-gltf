import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  extractFilesFromMarkdown,
  writeExtractedFiles,
} from "../src/cli-utils.js";
import { getProjectPrompts } from "../src/project-prompts.js";
import { generatePrompt } from "../src/prompt.js";

test("Markdown Extraction - Standard Project Files", () => {
  const mdContent = `
Here is your generated project:

### my_project/package.json
\`\`\`json
{
  "name": "my_project",
  "version": "1.0.0"
}
\`\`\`

Some intermediate explanation text.

### my_project/src/main.js
\`\`\`javascript
console.log("Hello, World!");
\`\`\`
  `;

  const files = extractFilesFromMarkdown(mdContent);

  assert.strictEqual(
    Object.keys(files).length,
    2,
    "Should extract exactly 2 files",
  );
  assert.ok(files["my_project/package.json"], "Should find package.json");
  assert.strictEqual(
    files["my_project/package.json"].trim(),
    '{\n  "name": "my_project",\n  "version": "1.0.0"\n}',
  );
  assert.ok(files["my_project/src/main.js"], "Should find main.js");
  assert.strictEqual(
    files["my_project/src/main.js"].trim(),
    'console.log("Hello, World!");',
  );
});

test("Markdown Extraction - Handles empty code blocks and weird spacing", () => {
  const mdContent = `
### empty_file.txt
\`\`\`
\`\`\`

###   weird_spacing.scad
\`\`\`openscad
cube(10);
\`\`\`
  `;

  const files = extractFilesFromMarkdown(mdContent);
  assert.strictEqual(Object.keys(files).length, 2);
  assert.strictEqual(files["empty_file.txt"].trim(), "");
  assert.strictEqual(files["weird_spacing.scad"].trim(), "cube(10);");
});

test("Markdown Extraction - Ignores invalid headers", () => {
  const mdContent = `
### This is just a standard markdown header, not a filepath
Some text goes here.

### my_project/real_file.json
\`\`\`json
{ "key": "value" }
\`\`\`

### Another loose header
\`\`\`
But it belongs to the previous context if not matched properly,
or gets ignored if the header regex doesn't match standard pathing.
\`\`\`
  `;

  const files = extractFilesFromMarkdown(mdContent);

  assert.strictEqual(
    Object.keys(files).length,
    1,
    "Should only extract the properly formatted filepath header",
  );
  assert.ok(
    files["my_project/real_file.json"],
    "Should contain the valid file",
  );
});

test("Markdown Extraction - Multiple code blocks per file handling", () => {
  const mdContent = `
### script.js
\`\`\`javascript
const a = 1;
\`\`\`
Some intervening text.
\`\`\`javascript
const b = 2;
\`\`\`
  `;

  const files = extractFilesFromMarkdown(mdContent);

  assert.strictEqual(Object.keys(files).length, 1, "Should map to one file");
  // By the current CLI parser design, once `inCodeBlock` switches back to false, it writes the file and clears currentFile.
  // Therefore, the second code block will be ignored unless a new `### filepath` is provided.
  assert.strictEqual(
    files["script.js"].trim(),
    "const a = 1;",
    "Should only capture the first code block immediately following the header",
  );
});

test("File Writing & Path Traversal Security", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scad-test-write-"));

  const maliciousFiles = {
    "safe_file.txt": "safe content",
    "../evil_outside.txt": "evil content",
    "nested/../../../../etc/passwd": "very evil content",
  };

  try {
    writeExtractedFiles(maliciousFiles, tempDir);

    // Verify safe file was written
    const safeContent = fs.readFileSync(
      path.join(tempDir, "safe_file.txt"),
      "utf-8",
    );
    assert.strictEqual(safeContent, "safe content");

    // Verify malicious files were sanitized and written INSIDE the target directory
    // The cli-utils.js strip leading ../, so they should become "evil_outside.txt" and "etc/passwd" locally.
    assert.ok(
      fs.existsSync(path.join(tempDir, "evil_outside.txt")),
      "Path traversal should be stripped, file should end up in root temp dir",
    );
    assert.ok(
      fs.existsSync(path.join(tempDir, "etc/passwd")),
      "Nested path traversal should be stripped, file should end up in temp dir",
    );

    // Verify they did NOT escape the temp directory
    const parentDir = path.dirname(tempDir);
    assert.ok(!fs.existsSync(path.join(parentDir, "evil_outside.txt")));
  } finally {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Project Prompts - Godot Generation", () => {
  const prompts = getProjectPrompts("godot");
  const promptRules = generatePrompt("A bouncy ball", { basic: false });
  const systemPrompt = prompts.buildSystemPrompt(promptRules, {});

  assert.ok(
    systemPrompt.includes("Godot 4 developer"),
    "Should declare Godot persona",
  );
  assert.ok(
    systemPrompt.includes("my_project/project.godot"),
    "Should require project.godot in delivery format",
  );
  assert.ok(
    systemPrompt.includes("OpenSCAD +Z (Up)      -> Godot +Y (Up)"),
    "Should include Godot coordinate conversion rules",
  );
});

test("Project Prompts - Rust Bevy Generation", () => {
  const prompts = getProjectPrompts("bevy");
  const promptRules = generatePrompt("A spaceship", { basic: false });
  const systemPrompt = prompts.buildSystemPrompt(promptRules, {});

  assert.ok(
    systemPrompt.includes("Rust Bevy developer"),
    "Should declare Bevy persona",
  );
  assert.ok(systemPrompt.includes("Cargo.toml"), "Should require Cargo.toml");
  assert.ok(
    systemPrompt.includes("build.rs"),
    "Should mention build.rs script",
  );
});

test("Project Prompts - Web Generation", () => {
  const prompts = getProjectPrompts("web");
  const promptRules = generatePrompt("A rotating cube", { basic: false });
  const systemPrompt = prompts.buildSystemPrompt(promptRules, {});

  assert.ok(
    systemPrompt.includes("Web 3D developer"),
    "Should declare Web persona",
  );
  assert.ok(
    systemPrompt.includes("package.json"),
    "Should require package.json",
  );
  assert.ok(
    systemPrompt.includes('"scad-gltf"'),
    "Should require scad-gltf dependency",
  );
});

test("Project Prompts - User SCAD Files Appending", () => {
  // Create a temporary SCAD file to test embedding
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scad-embed-"));
  const tempScadPath = path.join(tempDir, "test_base.scad");
  fs.writeFileSync(
    tempScadPath,
    "module custom_wheel() { cylinder(r=5, h=2); }",
  );

  try {
    const prompts = getProjectPrompts("godot");
    const promptRules = generatePrompt("A car using the wheel", {
      basic: false,
    });

    // Embed the file
    const systemPrompt = prompts.buildSystemPrompt(promptRules, {
      scadFiles: [tempScadPath],
    });

    assert.ok(
      systemPrompt.includes("USER PROVIDED OPENSCAD FILES"),
      "Should include user files header",
    );
    assert.ok(
      systemPrompt.includes("test_base.scad"),
      "Should include the filename",
    );
    assert.ok(
      systemPrompt.includes("module custom_wheel()"),
      "Should embed the file contents",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Project Prompts - WGPU Generation Specifics", () => {
  const prompts = getProjectPrompts("wgpu");
  const promptRules = generatePrompt("A low poly tree", { basic: false });
  const systemPrompt = prompts.buildSystemPrompt(promptRules, {});

  assert.ok(
    systemPrompt.includes("Rust wgpu developer"),
    "Should declare the exact wgpu persona",
  );
  assert.ok(systemPrompt.includes("Cargo.toml"), "Should require Cargo.toml");
  assert.ok(
    systemPrompt.includes("include `wgpu` as a dependency"),
    "Should specifically instruct adding wgpu as a dependency",
  );
});

test("Project Prompts - Raw SCAD Generation Specifics", () => {
  const prompts = getProjectPrompts("scad");
  const promptRules = generatePrompt("A modular bracket", { basic: false });
  const systemPrompt = prompts.buildSystemPrompt(promptRules, {});

  assert.ok(
    systemPrompt.includes(
      "Generate an OpenSCAD script to design the following: A modular bracket",
    ),
    "Should pipe the raw prompt directly out without wrapping it in a project delivery format",
  );
  assert.ok(
    !systemPrompt.includes("3. Delivery Format (Single Markdown File)"),
    "Should NOT require Markdown file structures for raw SCAD projects",
  );

  const inputReq = prompts.buildInputRequest("A modular bracket");
  assert.strictEqual(
    inputReq,
    "A modular bracket",
    "Raw SCAD should pass the task directly as the input request",
  );
});

test("Project Prompts - Error on Unknown Project Type", () => {
  assert.throws(
    () => getProjectPrompts("unreal_engine"),
    /Unknown project type: unreal_engine/,
    "Should throw a clear error when an unsupported project type is requested",
  );
});

test("Prompt Generator - Modular Flags", () => {
  // Test completely disabled
  const minimalRules = generatePrompt("Minimal cube", {
    basic: false,
    transmission: false,
    clearcoat: false,
    sheen: false,
    emissive: false,
    specular: false,
    iridescence: false,
    bakeColors: false,
    animation: false,
    lights: false,
    autoSmoothAngle: false,
  });

  assert.ok(
    !minimalRules.includes("Transmission:"),
    "Should omit transmission",
  );
  assert.ok(!minimalRules.includes("bone(name="), "Should omit animations");

  // Test with Animations and Lights
  const featuresRules = generatePrompt("Animated lamp", {
    basic: false,
    transmission: false,
    clearcoat: false,
    sheen: false,
    emissive: false,
    specular: false,
    iridescence: false,
    animation: true,
    lights: true,
  });

  assert.ok(
    featuresRules.includes("armature(animations="),
    "Should include animation rules",
  );
  assert.ok(
    featuresRules.includes("light(type="),
    "Should include lighting rules",
  );
});
