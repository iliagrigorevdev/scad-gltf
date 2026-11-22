import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mockConvertCode = `
export async function convertScadToGltf(scadCode, options = {}) {
  if (typeof globalThis.__mockConvertScadToGltf === "function") {
    return globalThis.__mockConvertScadToGltf(scadCode, options);
  }
  return new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
}
`;

const mockPromptUiCode = `
export const GODOT_ADDON_FILES = [
  { path: "addons/scad_importer/plugin.cfg", lang: "text", content: "[plugin]\\nname=\\"SCAD\\"\\n" },
  { path: "addons/scad_importer/scad_importer.gd", lang: "gdscript", content: "@tool\\nextends EditorSceneFormatImporter\\n# __scad_glbs\\n" },
];
export const RUST_TEMPLATE_FILES = [
  { path: "build.rs", lang: "rust", content: "// __scad_glbs fallback\\nfn main() {}\\n" },
];
export const UE_PLUGIN_FILES = [
  { path: "Plugins/ScadImporter/ScadImporter.uplugin", lang: "json", content: "{\\"FileVersion\\": 3}\\n" },
  { path: "Plugins/ScadImporter/Source/ScadImporter/ScadImporter.Build.cs", lang: "csharp", content: "public class ScadImporter {}" },
  { path: "Plugins/ScadImporter/Source/ScadImporter/Private/ScadImportFactory.cpp", lang: "cpp", content: "// __scad_glbs fallback\\nUScadImportFactory::FactoryCreateFile() {}" },
];
`;

const mockJsZipCode = `
export default class MockJSZip {
  constructor() {
    this._entries = new Map();
  }
  folder(name) {
    const prefix = name.endsWith("/") ? name : name + "/";
    return {
      file: (relPath, content) => {
        this._entries.set(prefix + relPath, content);
      },
    };
  }
  async generateAsync(_opts, onProgress) {
    if (onProgress) {
      onProgress({ percent: 50 });
      onProgress({ percent: 100 });
    }
    const blob = new Blob(["mock-zip"]);
    blob._entries = this._entries;
    return blob;
  }
}
`;

const loaderSrc = `
const convertUrl = ${JSON.stringify("data:text/javascript," + encodeURIComponent(mockConvertCode))};
const promptUiUrl = ${JSON.stringify("data:text/javascript," + encodeURIComponent(mockPromptUiCode))};
const jszipUrl = ${JSON.stringify("data:text/javascript," + encodeURIComponent(mockJsZipCode))};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "scad-gltf/convert") {
    return { shortCircuit: true, url: convertUrl };
  }
  if (
    specifier === "./prompt-ui.js" &&
    (context.parentURL?.endsWith("/editor/src/project-zip.js") ||
      context.parentURL?.endsWith("/editor/src/godot-project.js"))
  ) {
    return { shortCircuit: true, url: promptUiUrl };
  }
  if (specifier === "jszip") {
    return { shortCircuit: true, url: jszipUrl };
  }
  return nextResolve(specifier, context);
}
`;

register(
  "data:text/javascript," + encodeURIComponent(loaderSrc),
  import.meta.url,
);

const { parseMarkdownProject, exportProjectZip } =
  await import("../editor/src/project-zip.js");

test("project-zip - parseMarkdownProject detects godot, ue, rust, web, and generic projects", () => {
  assert.strictEqual(parseMarkdownProject("plain text"), null);
  assert.strictEqual(parseMarkdownProject("```openscad\ncube(1);\n```"), null);

  const godot = parseMarkdownProject(
    "### my_game/project.godot\n```ini\nconfig_version=5\n```",
  );
  assert.strictEqual(godot.projectType, "godot");
  assert.strictEqual(godot.isGodotProject, true);
  assert.strictEqual(godot.projectName, "my_game");

  const ue = parseMarkdownProject(
    [
      "### DroneSim/DroneSim.uproject",
      "```json",
      '{"FileVersion": 3}',
      "```",
      "### DroneSim/Content/Models/Drone.scad",
      "```openscad",
      "cube(1);",
      "```",
    ].join("\n"),
  );
  assert.strictEqual(ue.projectType, "ue");
  assert.strictEqual(ue.isGodotProject, false);
  assert.strictEqual(ue.projectName, "DroneSim");
  assert.deepStrictEqual(Object.keys(ue.files), [
    "DroneSim.uproject",
    "Content/Models/Drone.scad",
  ]);

  const rust = parseMarkdownProject(
    [
      "### rover_app/Cargo.toml",
      "```toml",
      '[package]\nname = "rover_app"',
      "```",
      "### rover_app/scad/rover.scad",
      "```openscad",
      "cube(2);",
      "```",
    ].join("\n"),
  );
  assert.strictEqual(rust.projectType, "rust");
  assert.strictEqual(rust.projectName, "rover_app");

  const web = parseMarkdownProject(
    [
      "### viewer_web/package.json",
      "```json",
      '{"name": "viewer_web"}',
      "```",
      "### viewer_web/scad/box.scad",
      "```openscad",
      "cube(3);",
      "```",
    ].join("\n"),
  );
  assert.strictEqual(web.projectType, "web");
  assert.strictEqual(web.projectName, "viewer_web");

  const generic = parseMarkdownProject(
    [
      "### robot_arm/base.scad",
      "```openscad",
      "cube(4);",
      "```",
      "### robot_arm/arm.scad",
      "```openscad",
      "sphere(2);",
      "```",
    ].join("\n"),
  );
  assert.strictEqual(generic.projectType, "generic");
  assert.strictEqual(generic.projectName, "robot_arm");
});

test("project-zip - exportProjectZip packs UE project with plugin and cached GLBs", async () => {
  const compileCalls = [];
  const mockGlb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x01]);
  globalThis.__mockConvertScadToGltf = async (code, opts) => {
    compileCalls.push({ code, additionalFiles: opts.additionalFiles });
    if (code.includes("// helper-only")) {
      throw new Error("Current top level geometry is empty");
    }
    return mockGlb;
  };

  try {
    const project = parseMarkdownProject(
      [
        "### DroneSim/DroneSim.uproject",
        "```json",
        '{"Plugins":[{"Name":"ScadImporter","Enabled":true}]}',
        "```",
        "### DroneSim/Content/Models/Parts.scad",
        "```openscad",
        "// helper-only\nmodule rotor() { cylinder(r=1, h=0.2); }",
        "```",
        "### DroneSim/Content/Models/Drone.scad",
        "```openscad",
        "include <Parts.scad>\nrotor();",
        "```",
        "### DroneSim/Plugins/ScadImporter/Source/ScadImporter/Private/ScadImportFactory.cpp",
        "```cpp",
        "// legacy without fallback\nUObject* UScadImportFactory::FactoryCreateFile() { return nullptr; }",
        "```",
      ].join("\n"),
    );

    const cache = new Map();
    const { zipBlob, rootFolderName, compiledCount } = await exportProjectZip(
      project,
      { wasmUrl: "openscad.wasm", scadCache: cache },
    );

    assert.strictEqual(rootFolderName, "DroneSim");
    assert.strictEqual(compiledCount, 1);

    const entries = zipBlob._entries;
    assert.deepStrictEqual(
      entries.get("DroneSim/__scad_glbs/Content/Models/Drone.scad.glb"),
      mockGlb,
    );
    assert.ok(
      !entries.has("DroneSim/__scad_glbs/Content/Models/Parts.scad.glb"),
    );
    assert.ok(
      entries.has("DroneSim/Plugins/ScadImporter/ScadImporter.uplugin"),
    );
    assert.ok(
      entries
        .get(
          "DroneSim/Plugins/ScadImporter/Source/ScadImporter/Private/ScadImportFactory.cpp",
        )
        .includes("__scad_glbs"),
    );

    const droneCall = compileCalls.find((c) => c.code.includes("rotor();"));
    assert.ok(
      droneCall.additionalFiles["Parts.scad"].includes("module rotor()"),
    );
  } finally {
    delete globalThis.__mockConvertScadToGltf;
  }
});

test("project-zip - exportProjectZip packs Rust, Web, and Godot projects with cached GLBs", async () => {
  const mockGlb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02]);
  globalThis.__mockConvertScadToGltf = async () => mockGlb;

  try {
    // Rust project with legacy build.rs gets upgraded fallback build.rs + __scad_glbs
    const rustProj = parseMarkdownProject(
      [
        "### rover_app/Cargo.toml",
        "```toml",
        '[package]\nname = "rover_app"',
        "```",
        "### rover_app/build.rs",
        "```rust",
        'fn main() { Command::new("scad-gltf").args(["convert", "./scad", "./assets/models", "--cache"]); }',
        "```",
        "### rover_app/scad/rover.scad",
        "```openscad",
        "cube(1);",
        "```",
      ].join("\n"),
    );
    const rustZip = await exportProjectZip(rustProj, {
      wasmUrl: "openscad.wasm",
    });
    assert.strictEqual(rustZip.rootFolderName, "rover_app");
    assert.strictEqual(rustZip.compiledCount, 1);
    assert.deepStrictEqual(
      rustZip.zipBlob._entries.get("rover_app/__scad_glbs/scad/rover.scad.glb"),
      mockGlb,
    );
    assert.ok(
      rustZip.zipBlob._entries
        .get("rover_app/build.rs")
        .includes("__scad_glbs"),
    );

    // Web project gets __scad_glbs without .gdignore
    const webProj = parseMarkdownProject(
      [
        "### viewer_web/package.json",
        "```json",
        '{"name": "viewer_web"}',
        "```",
        "### viewer_web/scad/box.scad",
        "```openscad",
        "cube(2);",
        "```",
      ].join("\n"),
    );
    const webZip = await exportProjectZip(webProj, {
      wasmUrl: "openscad.wasm",
    });
    assert.deepStrictEqual(
      webZip.zipBlob._entries.get("viewer_web/__scad_glbs/scad/box.scad.glb"),
      mockGlb,
    );
    assert.ok(!webZip.zipBlob._entries.has("viewer_web/__scad_glbs/.gdignore"));

    // Godot project delegates to exportGodotProjectZip (with .gdignore & addon)
    const godotProj = parseMarkdownProject(
      [
        "### space_sim/project.godot",
        "```ini",
        "config_version=5",
        "```",
        "### space_sim/models/ship.scad",
        "```openscad",
        "cube(3);",
        "```",
      ].join("\n"),
    );
    const godotZip = await exportProjectZip(godotProj, {
      wasmUrl: "openscad.wasm",
    });
    assert.strictEqual(
      godotZip.zipBlob._entries.get("space_sim/__scad_glbs/.gdignore"),
      "",
    );
    assert.ok(
      godotZip.zipBlob._entries.has(
        "space_sim/addons/scad_importer/scad_importer.gd",
      ),
    );
    assert.deepStrictEqual(
      godotZip.zipBlob._entries.get(
        "space_sim/__scad_glbs/models/ship.scad.glb",
      ),
      mockGlb,
    );
  } finally {
    delete globalThis.__mockConvertScadToGltf;
  }
});

test("addons - UE ScadImportFactory.cpp and Rust build.rs include __scad_glbs fallback", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const rustBuildRs = fs.readFileSync(
    path.join(repoRoot, "rust/build.rs"),
    "utf-8",
  );
  assert.ok(rustBuildRs.includes("__scad_glbs"));
  assert.ok(rustBuildRs.includes("ErrorKind::NotFound"));
  assert.ok(rustBuildRs.includes("assets"));

  const ueFactoryCpp = fs.readFileSync(
    path.join(
      repoRoot,
      "ue/Plugins/ScadImporter/Source/ScadImporter/Private/ScadImportFactory.cpp",
    ),
    "utf-8",
  );
  assert.ok(ueFactoryCpp.includes("IsScadGltfAvailable"));
  assert.ok(ueFactoryCpp.includes("__scad_glbs"));
  assert.ok(ueFactoryCpp.includes("GetCachedGlbPath"));
});
