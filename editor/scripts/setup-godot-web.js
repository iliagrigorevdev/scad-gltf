import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWebLibraries } from "../../src/godot-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const godotPublicDir = path.resolve(__dirname, "../public/godot");

const hasGodotJs = fs.existsSync(path.join(godotPublicDir, "godot.js"));
const hasGodotWasm = fs.existsSync(path.join(godotPublicDir, "godot.wasm"));

if (!hasGodotJs || !hasGodotWasm) {
  try {
    console.log("⚙️  Setting up Godot Web libraries in editor/public/godot...");
    const usedZip = ensureWebLibraries(godotPublicDir);
    console.log(`✅ Godot Web libraries ready (${usedZip}).`);
  } catch (err) {
    console.warn(
      `⚠️  Could not automatically set up Godot Web libraries: ${err.message}`,
    );
    console.warn(
      "   The SCAD editor will still work, but playing Godot .md projects requires godot.js and godot.wasm in editor/public/godot/.",
    );
  }
}
