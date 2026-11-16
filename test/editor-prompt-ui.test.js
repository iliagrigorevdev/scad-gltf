import test from "node:test";
import assert from "node:assert";
import { register } from "node:module";

const mockGlobMap = {
  godot: {
    "../../godot/addons/scad_importer/scad_import.gd":
      "@tool\nextends EditorImportPlugin",
    "../../godot/addons/scad_importer/plugin.cfg": '[plugin]\nname="SCAD"',
  },
  rust: {
    "../../rust/build.rs": "fn main() {}",
  },
  ue: {
    "../../ue/Plugins/ScadImporter/ScadImporter.uplugin": '{"FileVersion": 3}',
    "../../ue/Plugins/ScadImporter/Source/ScadImporter/ScadImporter.Build.cs":
      "public class ScadImporter {}",
    "../../ue/Plugins/ScadImporter/Source/ScadImporter/Private/ScadImporter.cpp":
      '#include "ScadImporter.h"',
    "../../ue/Plugins/ScadImporter/Source/ScadImporter/Public/ScadImporter.h":
      "#pragma once",
  },
};

const loaderSrc = `
const globMap = ${JSON.stringify(mockGlobMap)};
export async function load(url, context, nextLoad) {
  if (url.endsWith("/editor/src/prompt-ui.js")) {
    const res = await nextLoad(url, context);
    let src = typeof res.source === "string"
      ? res.source
      : Buffer.from(res.source).toString("utf8");
    src = src.replace(/import\\.meta\\.glob\\(([\\s\\S]*?)\\);/g, (_m, args) => {
      if (args.includes("godot/addons")) return JSON.stringify(globMap.godot) + ";";
      if (args.includes("rust/build.rs")) return JSON.stringify(globMap.rust) + ";";
      if (args.includes("ue/Plugins")) return JSON.stringify(globMap.ue) + ";";
      return "{};";
    });
    return { shortCircuit: true, format: "module", source: src };
  }
  return nextLoad(url, context);
}
`;

register(
  "data:text/javascript," + encodeURIComponent(loaderSrc),
  import.meta.url,
);

class MiniElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.id = "";
    this.className = "";
    this.type = "";
    this.checked = false;
    this.defaultChecked = false;
    this.indeterminate = false;
    this.value = "";
    this.textContent = "";
    this.placeholder = "";
    this.children = [];
    this.parentNode = null;
    this._listeners = new Map();
    this.classList = {
      contains: (cls) =>
        this.className.split(/\s+/).filter(Boolean).includes(cls),
      add: (...classes) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const cls of classes) set.add(cls);
        this.className = Array.from(set).join(" ");
      },
      remove: (...classes) => {
        const removeSet = new Set(classes);
        this.className = this.className
          .split(/\s+/)
          .filter((c) => c && !removeSet.has(c))
          .join(" ");
      },
      toggle: (cls, force) => {
        const has = this.classList.contains(cls);
        const shouldAdd = force !== undefined ? Boolean(force) : !has;
        if (shouldAdd) this.classList.add(cls);
        else this.classList.remove(cls);
        return shouldAdd;
      },
    };
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (
      this.tagName === "SELECT" &&
      child.tagName === "OPTION" &&
      this.children.length === 1
    ) {
      this.value = child.value;
    }
    return child;
  }
  set innerHTML(html) {
    this.children = [];
    if (!html) return;
    const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
    const stack = [this];
    const voidTags = new Set(["input", "br", "hr"]);
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const full = match[0];
      const tag = match[1].toLowerCase();
      const attrsStr = match[2];
      if (full.startsWith("</")) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const el = new MiniElement(tag);
      const idM = attrsStr.match(/\bid="([^"]*)"/);
      if (idM) el.id = idM[1];
      const clsM = attrsStr.match(/\bclass="([^"]*)"/);
      if (clsM) el.className = clsM[1];
      const typeM = attrsStr.match(/\btype="([^"]*)"/);
      if (typeM) el.type = typeM[1];
      if (/\bchecked\b/.test(attrsStr)) {
        el.checked = true;
        el.defaultChecked = true;
      }
      stack[stack.length - 1].appendChild(el);
      if (!full.endsWith("/>") && !voidTags.has(tag)) {
        stack.push(el);
      }
    }
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    let cur = this;
    while (cur) {
      const list = cur._listeners.get(event.type) || [];
      for (const fn of list) fn(event);
      cur = cur.parentNode;
    }
  }
  _matches(sel) {
    if (sel.startsWith("#")) return this.id === sel.slice(1);
    if (sel.startsWith("."))
      return this.className.split(/\s+/).includes(sel.slice(1));
    if (sel === 'input[type="checkbox"]')
      return this.tagName === "INPUT" && this.type === "checkbox";
    return this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c._matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

function installStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  return map;
}

installStorage();
globalThis.document = {
  createElement: (tag) => new MiniElement(tag),
};

const {
  GODOT_ADDON_FILES,
  RUST_TEMPLATE_FILES,
  UE_PLUGIN_FILES,
  PROMPT_UI_HTML,
  getSelectedPromptProfile,
  setupPromptToggles,
  getPromptOptions,
  buildPromptFromUI,
} = await import("../editor/src/prompt-ui.js");

test("prompt-ui - Maps template files for Godot, Rust, and UE", () => {
  assert.deepStrictEqual(
    GODOT_ADDON_FILES.map((f) => [f.path, f.lang]),
    [
      ["addons/scad_importer/plugin.cfg", "text"],
      ["addons/scad_importer/scad_import.gd", "gdscript"],
    ],
  );
  assert.deepStrictEqual(
    RUST_TEMPLATE_FILES.map((f) => [f.path, f.lang]),
    [["build.rs", "rust"]],
  );
  assert.deepStrictEqual(
    UE_PLUGIN_FILES.map((f) => [f.path, f.lang]),
    [
      ["Plugins/ScadImporter/ScadImporter.uplugin", "json"],
      [
        "Plugins/ScadImporter/Source/ScadImporter/Private/ScadImporter.cpp",
        "cpp",
      ],
      ["Plugins/ScadImporter/Source/ScadImporter/Public/ScadImporter.h", "cpp"],
      [
        "Plugins/ScadImporter/Source/ScadImporter/ScadImporter.Build.cs",
        "csharp",
      ],
    ],
  );
});

test("prompt-ui - setupPromptToggles migrates legacy settings, syncs groups, switches profiles, and resets", () => {
  const storeMap = installStorage();
  storeMap.set(
    "test_prompt_key",
    JSON.stringify({ "opt-lights": true, "opt-pbr-transmission": false }),
  );

  const container = new MiniElement("div");
  container.innerHTML = PROMPT_UI_HTML;
  const helpTextEl = new MiniElement("p");
  const descEl = new MiniElement("textarea");

  setupPromptToggles(container, "test_prompt_key", { helpTextEl, descEl });

  assert.strictEqual(getSelectedPromptProfile(container), "scad");
  const opts = getPromptOptions(container);
  assert.strictEqual(opts.lights, true);
  assert.strictEqual(opts.transmission, false);

  // Extended PBR parent checkbox should be indeterminate because transmission is unchecked
  const pbrAll = container.querySelector("#opt-pbr-all");
  assert.strictEqual(pbrAll.checked, false);
  assert.strictEqual(pbrAll.indeterminate, true);

  // Clicking Enable All on Baking checks all bake children and persists
  const bakeAll = container.querySelector("#opt-bake-all");
  bakeAll.checked = true;
  bakeAll.dispatchEvent({ type: "change" });
  assert.strictEqual(getPromptOptions(container).bakeColors, true);
  assert.strictEqual(getPromptOptions(container).colormap, true);

  const resetBtn = container.querySelector("#opt-prompt-reset");
  assert.strictEqual(resetBtn.classList.contains("has-changes"), true);

  // Switch to Godot profile -> applies Godot defaults and updates UI hints
  const profileSelect = container.querySelector("#opt-prompt-profile");
  profileSelect.value = "godot";
  profileSelect.dispatchEvent({ type: "change" });
  assert.strictEqual(getSelectedPromptProfile(container), "godot");
  assert.ok(helpTextEl.textContent.includes("Godot 4"));
  assert.ok(
    descEl.placeholder.includes("Godot") || descEl.placeholder.includes("3D"),
  );
  assert.strictEqual(getPromptOptions(container).transmission, false);
  assert.strictEqual(resetBtn.classList.contains("has-changes"), false);

  // Override a Godot option -> highlights reset; toggling back clears highlight
  const lightsCb = container.querySelector("#opt-lights");
  lightsCb.checked = true;
  lightsCb.dispatchEvent({ type: "change" });
  assert.strictEqual(getPromptOptions(container).lights, true);
  assert.strictEqual(resetBtn.classList.contains("has-changes"), true);

  lightsCb.checked = false;
  lightsCb.dispatchEvent({ type: "change" });
  assert.strictEqual(resetBtn.classList.contains("has-changes"), false);

  // Override again, then click Reset -> restores default and clears highlight
  lightsCb.checked = true;
  lightsCb.dispatchEvent({ type: "change" });
  assert.strictEqual(resetBtn.classList.contains("has-changes"), true);

  resetBtn.dispatchEvent({ type: "click" });
  assert.strictEqual(getPromptOptions(container).lights, false);
  assert.strictEqual(resetBtn.classList.contains("has-changes"), false);
});

test("prompt-ui - buildPromptFromUI builds prompts with template and reference files", () => {
  installStorage();
  const container = new MiniElement("div");
  container.innerHTML = PROMPT_UI_HTML;
  setupPromptToggles(container, "test_build_key");

  const scadPrompt = buildPromptFromUI(container, "A brass compass", {
    referenceFiles: [{ path: "base.scad", content: "cylinder(r=5, h=1);" }],
  });
  assert.ok(scadPrompt.includes("A brass compass"));
  assert.ok(scadPrompt.includes("base.scad"));
  assert.ok(scadPrompt.includes("cylinder(r=5, h=1);"));

  const profileSelect = container.querySelector("#opt-prompt-profile");
  profileSelect.value = "bevy";
  profileSelect.dispatchEvent({ type: "change" });
  const bevyPrompt = buildPromptFromUI(container, "A rover");
  assert.ok(bevyPrompt.includes("=== SYSTEM PROMPT ==="));
  assert.ok(bevyPrompt.includes("fn main() {}"));
  assert.ok(bevyPrompt.includes("A rover"));
});
