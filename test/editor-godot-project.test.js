import test from "node:test";
import assert from "node:assert";
import { register } from "node:module";

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
  { path: "addons/scad_importer/scad_import.gd", lang: "gdscript", content: "@tool\\nextends EditorImportPlugin\\n" },
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
  if (specifier === "./prompt-ui.js" && context.parentURL?.endsWith("/editor/src/godot-project.js")) {
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

const {
  parseGodotMarkdownProject,
  compileGodotProjectToPck,
  exportGodotProjectWebZip,
  exportGodotProjectZip,
} = await import("../editor/src/godot-project.js");

function unpackPckPaths(pck) {
  const view = new DataView(pck.buffer, pck.byteOffset, pck.byteLength);
  const decoder = new TextDecoder();
  const count = view.getUint32(96, true);
  let pos = 100;
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const pathLen = view.getUint32(pos, true);
    pos += 4;
    const p = decoder
      .decode(pck.subarray(pos, pos + pathLen))
      .replace(/\0+$/, "");
    pos += pathLen;
    const offset = Number(view.getBigUint64(pos, true));
    pos += 8;
    const size = Number(view.getBigUint64(pos, true));
    pos += 8;
    pos += 20; // md5 + flags
    files.set(p, pck.subarray(offset, offset + size));
  }
  return files;
}

test("godot-project - parseGodotMarkdownProject detects project root and strips prefix", () => {
  assert.strictEqual(parseGodotMarkdownProject("plain text"), null);
  assert.strictEqual(
    parseGodotMarkdownProject("### main.scad\n```openscad\ncube(1);\n```"),
    null,
  );

  const md = `
### other_folder/notes.txt
\`\`\`text
ignore me
\`\`\`

### my_game/project.godot
\`\`\`ini
config_version=5
\`\`\`

### my_game/scripts/player.gd
\`\`\`gdscript
extends CharacterBody3D
\`\`\`
`;

  const parsed = parseGodotMarkdownProject(md);
  assert.strictEqual(parsed.isGodotProject, true);
  assert.strictEqual(parsed.projectName, "my_game");
  assert.strictEqual(parsed.rootPrefix, "my_game/");
  assert.deepStrictEqual(Object.keys(parsed.files), [
    "project.godot",
    "scripts/player.gd",
  ]);
});

test("godot-project - compileGodotProjectToPck compiles SCADs, patches project.godot, builds class cache, and skips unreferenced empty libs", async () => {
  const compileCalls = [];
  globalThis.__mockConvertScadToGltf = async (code, opts) => {
    compileCalls.push({ code, additionalFiles: opts.additionalFiles });
    if (code.includes("// empty-helper")) {
      throw new Error("Current top level geometry is empty");
    }
    return new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02]);
  };

  try {
    const project = {
      projectName: "space_game",
      files: {
        "project.godot":
          'config_version=5\n[application]\nconfig/name="Space"\n',
        "addons/scad_importer/plugin.cfg": "ignored-in-pck",
        "models/shared.scad":
          "// empty-helper\nmodule base_shape() { cube(1); }",
        "models/ship.scad": "include <shared.scad>\nbase_shape();",
        "scenes/main.tscn":
          '[ext_resource type="PackedScene" path="res://models/ship.scad" id="1"]',
        "scripts/player.gd": [
          "@tool",
          '@icon("res://icon.png")',
          "class_name PlayerShip extends Node3D # hero",
          "class InnerHelper:",
          "    pass",
        ].join("\n"),
      },
    };

    const cache = new Map();
    const progressMsgs = [];
    const res1 = await compileGodotProjectToPck(project, {
      wasmUrl: "openscad.wasm",
      scadCache: cache,
      onProgress: (m) => progressMsgs.push(m),
    });

    assert.strictEqual(res1.compiledCount, 1);
    assert.ok(
      res1.logs.some((l) =>
        l.includes("Skipped helper library models/shared.scad"),
      ),
    );
    assert.ok(progressMsgs.some((m) => m.includes("Packing Godot project")));

    const shipCall = compileCalls.find((c) => c.code.includes("base_shape();"));
    assert.ok(
      shipCall.additionalFiles["shared.scad"].includes("module base_shape()"),
    );

    const pckFiles = unpackPckPaths(res1.pckBuffer);
    const decoder = new TextDecoder();

    assert.ok(pckFiles.has("res://__scad_glbs/models/ship.scad.glb"));
    assert.ok(pckFiles.has("res://__scad_runtime_loader.gd"));
    assert.ok(!pckFiles.has("res://addons/scad_importer/plugin.cfg"));

    const patchedProject = decoder.decode(pckFiles.get("res://project.godot"));
    assert.ok(
      patchedProject.includes(
        'ScadRuntimeLoader="*res://__scad_runtime_loader.gd"',
      ),
    );
    assert.ok(
      patchedProject.includes(
        'renderer/rendering_method.web="gl_compatibility"',
      ),
    );

    const classCache = decoder.decode(
      pckFiles.get("res://.godot/global_script_class_cache.cfg"),
    );
    assert.ok(classCache.includes('"class": &"PlayerShip"'));
    assert.ok(classCache.includes('"base": &"Node3D"'));
    assert.ok(classCache.includes('"is_tool": true'));
    assert.ok(!classCache.includes("InnerHelper"));

    // Second run uses scadCache for ship.scad
    const callsBeforeSecond = compileCalls.length;
    await compileGodotProjectToPck(project, {
      wasmUrl: "openscad.wasm",
      scadCache: cache,
    });
    // shared.scad isn't cached because it threw, ship.scad IS cached
    assert.strictEqual(compileCalls.length, callsBeforeSecond + 1);
  } finally {
    delete globalThis.__mockConvertScadToGltf;
  }
});

test("godot-project - exportGodotProjectWebZip bundles index.html, pck, and runtime assets", async (t) => {
  globalThis.__mockConvertScadToGltf = async () =>
    new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("godot.js")) {
      return new Response("console.log('godot');", {
        status: 200,
        headers: { "content-type": "application/javascript" },
      });
    }
    if (url.endsWith("godot.wasm")) {
      return new Response(
        new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
        {
          status: 200,
          headers: { "content-type": "application/wasm" },
        },
      );
    }
    if (url.endsWith("godot.worker.js")) {
      return new Response("self.onmessage = () => {};", {
        status: 200,
        headers: { "content-type": "application/javascript" },
      });
    }
    return new Response("", { status: 404 });
  });

  try {
    const project = {
      projectName: "My Game",
      files: {
        "project.godot": "config_version=5\n",
        "box.scad": "cube(1);",
      },
    };

    const { zipBlob, pckFileName, rootFolderName, compiledCount } =
      await exportGodotProjectWebZip(project, {
        folderName: "Demo <Web>",
        godotBaseUrl: "./godot/godot",
      });

    assert.strictEqual(compiledCount, 1);
    assert.strictEqual(pckFileName, "My_Game.pck");
    assert.strictEqual(rootFolderName, "Demo_Web");

    const entries = zipBlob._entries;
    assert.ok(entries.has("Demo_Web/index.html"));
    assert.ok(entries.has("Demo_Web/My_Game.pck"));
    assert.ok(entries.has("Demo_Web/godot.js"));
    assert.ok(entries.has("Demo_Web/godot.wasm"));
    assert.ok(entries.has("Demo_Web/godot.worker.js"));

    const html = entries.get("Demo_Web/index.html");
    assert.ok(html.includes("<title>Demo &lt;Web&gt;</title>"));
    assert.ok(html.includes('mainPack: "My_Game.pck"'));
    assert.ok(html.includes("threads: true"));
  } finally {
    delete globalThis.__mockConvertScadToGltf;
  }
});

test("godot-project - exportGodotProjectWebZip rejects invalid HTML fallback for wasm", async (t) => {
  globalThis.__mockConvertScadToGltf = async () =>
    new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("godot.js")) {
      return new Response("ok", {
        status: 200,
        headers: { "content-type": "application/javascript" },
      });
    }
    return new Response("<html>404</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });

  try {
    await assert.rejects(
      () =>
        exportGodotProjectWebZip(
          { projectName: "p", files: { "project.godot": "config_version=5" } },
          { godotBaseUrl: "./godot/godot" },
        ),
      /Missing Godot Web runtime file/,
    );
  } finally {
    delete globalThis.__mockConvertScadToGltf;
  }
});

test("godot-project - exportGodotProjectZip auto-injects addon files and caches compiled GLBs", async () => {
  await assert.rejects(
    () => exportGodotProjectZip(null),
    /Invalid Godot project/,
  );

  let compileCount = 0;
  const mockGlb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x09]);
  globalThis.__mockConvertScadToGltf = async (code) => {
    compileCount++;
    if (code.includes("// empty-helper")) {
      throw new Error("Current top level geometry is empty");
    }
    return mockGlb;
  };

  try {
    const project = {
      projectName: "raw_proj",
      files: {
        "project.godot": "config_version=5\n",
        "cube.scad": "cube(1);",
        "lib/helper.scad": "// empty-helper\nmodule h() {}",
        "addons/scad_importer/plugin.cfg": "custom-cfg",
      },
    };

    const cache = new Map();
    const { zipBlob, rootFolderName, fileCount, compiledCount } =
      await exportGodotProjectZip(project, {
        wasmUrl: "openscad.wasm",
        scadCache: cache,
      });

    assert.strictEqual(rootFolderName, "raw_proj");
    assert.strictEqual(compiledCount, 1);
    assert.strictEqual(fileCount, 7);
    assert.strictEqual(
      zipBlob._entries.get("raw_proj/addons/scad_importer/plugin.cfg"),
      "custom-cfg",
    );
    assert.ok(
      zipBlob._entries.has("raw_proj/addons/scad_importer/scad_import.gd"),
    );
    assert.strictEqual(
      zipBlob._entries.get("raw_proj/__scad_glbs/.gdignore"),
      "",
    );
    assert.deepStrictEqual(
      zipBlob._entries.get("raw_proj/__scad_glbs/cube.scad.glb"),
      mockGlb,
    );
    assert.ok(
      !zipBlob._entries.has("raw_proj/__scad_glbs/lib/helper.scad.glb"),
    );

    // Re-exporting reuses cached cube.scad GLB without recompiling it
    const callsBefore = compileCount;
    await exportGodotProjectZip(project, {
      wasmUrl: "openscad.wasm",
      scadCache: cache,
    });
    assert.strictEqual(compileCount, callsBefore + 1);

    // Projects with no SCAD models omit __scad_glbs directory
    const noScad = await exportGodotProjectZip({
      projectName: "no_scad",
      files: { "project.godot": "config_version=5\n" },
    });
    assert.strictEqual(noScad.compiledCount, 0);
    assert.strictEqual(noScad.fileCount, 1);
    assert.ok(!noScad.zipBlob._entries.has("no_scad/__scad_glbs/.gdignore"));
  } finally {
    delete globalThis.__mockConvertScadToGltf;
  }
});
