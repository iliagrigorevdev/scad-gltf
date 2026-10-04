import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { convertScadToGltf } from "../src/convert.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../src/ext/openscad.wasm");

// Polyfill fetch for Node.js (identical to bin/convert.js)
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const urlStr = url.toString();
  if (urlStr.startsWith("file://") || urlStr.endsWith(".wasm")) {
    const normalizedPath = urlStr.startsWith("file://")
      ? fileURLToPath(urlStr)
      : urlStr;
    const buffer = fs.readFileSync(normalizedPath);
    return new Response(buffer, {
      status: 200,
      headers: { "Content-Type": "application/wasm" },
    });
  }
  return originalFetch ? originalFetch(url, options) : undefined;
};

test("WASM Compiler - Basic SCAD to GLB Conversion", async () => {
  const scadCode = "cube([10, 10, 10]);";
  const wasmUrl = pathToFileURL(wasmPath).href;

  const glbData = await convertScadToGltf(scadCode, {
    wasmUrl,
    binary: true,
  });

  assert.ok(glbData instanceof Uint8Array, "Output should be a Uint8Array");
  assert.ok(glbData.length > 100, "GLB output should have substance");

  // Verify GLB Magic Header (0x46546C67 -> "glTF")
  assert.strictEqual(glbData[0], 0x67); // g
  assert.strictEqual(glbData[1], 0x6c); // l
  assert.strictEqual(glbData[2], 0x54); // T
  assert.strictEqual(glbData[3], 0x46); // F
});

test("WASM Compiler - Virtual Filesystem (include/use)", async () => {
  const scadCode = `
    include <parts/wheel.scad>
    color("red") wheel();
  `;
  const wasmUrl = pathToFileURL(wasmPath).href;

  const glbData = await convertScadToGltf(scadCode, {
    wasmUrl,
    binary: true,
    additionalFiles: {
      "parts/wheel.scad": "module wheel() { cylinder(r=5, h=2); }",
    },
  });

  assert.ok(
    glbData.length > 0,
    "Should compile successfully with virtual dependencies",
  );
});

test("WASM Compiler - Variables Injection via Options", async () => {
  // Using an unassigned variable. If not passed in via variables config,
  // it would default to undef and might not render as expected or throw warnings.
  const scadCode = `
    cube([MY_SIZE, MY_SIZE, MY_SIZE]);
  `;
  const wasmUrl = pathToFileURL(wasmPath).href;

  const glbData = await convertScadToGltf(scadCode, {
    wasmUrl,
    binary: true,
    variables: {
      MY_SIZE: 15,
    },
  });

  assert.ok(glbData instanceof Uint8Array, "Output should be a Uint8Array");
  assert.ok(
    glbData.length > 100,
    "Should compile successfully into a GLB file",
  );
});
