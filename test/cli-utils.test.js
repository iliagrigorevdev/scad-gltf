import test from "node:test";
import assert from "node:assert";
import zlib from "node:zlib";
import { generateScadPreviewUrl } from "../src/cli-utils.js";

test("generateScadPreviewUrl - Compresses and encodes correctly", () => {
  const code = "cube([10,10,10]);";
  const baseUrl = "http://localhost:3000";

  const url = generateScadPreviewUrl(code, baseUrl);

  assert.ok(
    url.startsWith("http://localhost:3000/#c"),
    "URL should format correctly",
  );

  // Extract the base64 part
  const base64Part = url.replace("http://localhost:3000/#c", "");

  // Reverse the URL-safe replacements
  let standardBase64 = base64Part.replace(/-/g, "+").replace(/_/g, "/");
  // Pad if necessary
  while (standardBase64.length % 4) {
    standardBase64 += "=";
  }

  // Decode base64 -> Deflated Buffer
  const deflatedBuffer = Buffer.from(standardBase64, "base64");

  // Inflate -> Original String
  const inflatedString = zlib.inflateRawSync(deflatedBuffer).toString("utf-8");

  assert.strictEqual(
    inflatedString,
    code,
    "Inflated code should match original input",
  );
});

test("generateScadPreviewUrl - Handles empty input", () => {
  const url = generateScadPreviewUrl("");
  assert.ok(
    url.includes("#c"),
    "Should still generate a valid empty payload link",
  );
});
