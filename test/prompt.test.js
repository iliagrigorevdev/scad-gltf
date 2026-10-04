import test from "node:test";
import assert from "node:assert";
import { generatePrompt } from "../src/prompt.js";

test("Prompt Generator - Requires Description", () => {
  assert.throws(
    () => generatePrompt(),
    /A description is required/,
    "Should throw if description is missing",
  );
});

test("Prompt Generator - Defaults", () => {
  const prompt = generatePrompt("A spaceship");

  // Default features
  assert.ok(prompt.includes("metalness"));
  assert.ok(prompt.includes("transmission"));
  assert.ok(prompt.includes("sheen"));
  assert.ok(prompt.includes("$asa="));
  assert.ok(prompt.includes("armature(animations="));

  // Features off by default
  assert.ok(!prompt.includes("lazy-union"));
  assert.ok(!prompt.includes("bake("));
  assert.ok(!prompt.includes("light("));
});

test("Prompt Generator - Texture Baking Flags", () => {
  const prompt = generatePrompt("A textured rock", {
    bakeColors: true,
    bakeNormals: true,
  });

  assert.ok(
    prompt.includes("bake(colors=true, normals=true"),
    "Should build bake signature correctly",
  );
  assert.ok(
    prompt.includes("project and bake the high-poly's solid colors"),
    "Should include color explanation",
  );
  assert.ok(
    prompt.includes("tangent-space normal map"),
    "Should include normal explanation",
  );
});

test("Prompt Generator - Geometry & Output Toggles", () => {
  const prompt = generatePrompt("A gear", {
    lazyUnion: true,
    modelName: true,
    lights: true,
  });

  assert.ok(prompt.includes("lazy-union"), "Should mention lazy-union");
  assert.ok(prompt.includes("Model Name:"), "Should include model naming rule");
  assert.ok(prompt.includes("light(type="), "Should include light syntax");
});
