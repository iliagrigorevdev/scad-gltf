import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  convertScad,
  convertScadToFormat,
  convertScadToGltf,
  convertScadTo3MF,
  SUPPORTED_EXTENSIONS,
} from "../src/convert.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../ext/openscad.wasm");

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

test("SUPPORTED_EXTENSIONS - Contains standard OpenSCAD export formats", () => {
  const expectedFormats = [
    "glb",
    "gltf",
    "3mf",
    "stl",
    "obj",
    "off",
    "wrl",
    "csg",
    "svg",
  ];

  for (const fmt of expectedFormats) {
    assert.ok(
      SUPPORTED_EXTENSIONS.has(fmt),
      `SUPPORTED_EXTENSIONS should include ${fmt}`,
    );
  }
});

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

test("WASM Compiler - Non-binary glTF Conversion", async () => {
  const scadCode = "cube([10, 10, 10]);";
  const wasmUrl = pathToFileURL(wasmPath).href;

  // Test via convertScad with format 'gltf'
  const gltfData = await convertScad(scadCode, "gltf", { wasmUrl });

  assert.ok(gltfData instanceof Uint8Array, "Output should be a Uint8Array");
  assert.ok(gltfData.length > 50, "glTF output should have substance");

  // Verify it is NOT binary GLB (should not start with binary magic bytes)
  const isGlbMagic =
    gltfData[0] === 0x67 &&
    gltfData[1] === 0x6c &&
    gltfData[2] === 0x54 &&
    gltfData[3] === 0x46;
  assert.ok(!isGlbMagic, "Non-binary glTF should not have GLB magic header");

  // Verify it parses as valid glTF JSON
  const gltfJsonText = new TextDecoder().decode(gltfData);
  const gltfParsed = JSON.parse(gltfJsonText);
  assert.ok(gltfParsed.asset, "Parsed glTF should contain asset metadata");
  assert.strictEqual(gltfParsed.asset.version, "2.0");

  // Test convertScadToGltf directly with binary: false
  const directGltfData = await convertScadToGltf(scadCode, {
    wasmUrl,
    binary: false,
  });
  const directParsed = JSON.parse(new TextDecoder().decode(directGltfData));
  assert.ok(
    directParsed.asset,
    "Direct non-binary glTF should contain asset metadata",
  );
});

test("WASM Compiler - 3MF Conversion", async () => {
  const scadCode = "cube([10, 10, 10]);";
  const wasmUrl = pathToFileURL(wasmPath).href;

  // Test convertScadTo3MF
  const threeMfData = await convertScadTo3MF(scadCode, { wasmUrl });
  assert.ok(threeMfData instanceof Uint8Array, "Output should be a Uint8Array");
  assert.ok(threeMfData.length > 100, "3MF output should have substance");

  // 3MF files are OPC / ZIP archives (magic bytes: 0x50 0x4B -> 'PK')
  assert.strictEqual(
    threeMfData[0],
    0x50,
    "3MF should start with PK zip header byte 1",
  );
  assert.strictEqual(
    threeMfData[1],
    0x4b,
    "3MF should start with PK zip header byte 2",
  );

  // Test convertScad with '3mf' format
  const generic3mfData = await convertScad(scadCode, "3mf", { wasmUrl });
  assert.strictEqual(generic3mfData[0], 0x50);
  assert.strictEqual(generic3mfData[1], 0x4b);
});

test("WASM Compiler - Other OpenSCAD Formats (STL, OBJ, CSG, SVG)", async () => {
  const wasmUrl = pathToFileURL(wasmPath).href;

  // STL export
  const stlData = await convertScad("cube([10, 10, 10]);", "stl", { wasmUrl });
  assert.ok(stlData instanceof Uint8Array, "STL output should be a Uint8Array");
  assert.ok(
    stlData.length > 84,
    "STL output should have valid mesh header and triangles",
  );

  // OBJ export
  const objData = await convertScad("cube([10, 10, 10]);", "obj", { wasmUrl });
  assert.ok(objData instanceof Uint8Array, "OBJ output should be a Uint8Array");
  const objText = new TextDecoder().decode(objData);
  assert.ok(
    objText.includes("v "),
    "OBJ text should contain vertex definitions",
  );

  // CSG export
  const csgData = await convertScad("cube([10, 10, 10]);", "csg", { wasmUrl });
  assert.ok(csgData instanceof Uint8Array, "CSG output should be a Uint8Array");
  const csgText = new TextDecoder().decode(csgData);
  assert.ok(
    csgText.includes("cube"),
    "CSG text should reflect OpenSCAD CSG structure",
  );

  // SVG export (2D geometry)
  const svgData = await convertScad("circle(r=10);", "svg", { wasmUrl });
  assert.ok(svgData instanceof Uint8Array, "SVG output should be a Uint8Array");
  const svgText = new TextDecoder().decode(svgData);
  assert.ok(svgText.includes("<svg"), "SVG text should contain svg tags");

  // Format with leading dot
  const dotStlData = await convertScadToFormat("cube([5, 5, 5]);", ".stl", {
    wasmUrl,
  });
  assert.ok(
    dotStlData instanceof Uint8Array,
    "convertScadToFormat with leading dot should succeed",
  );
  assert.ok(dotStlData.length > 84);
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
