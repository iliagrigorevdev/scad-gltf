import test from "node:test";
import assert from "node:assert";

class ModalNode {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.id = "";
    this.className = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.colSpan = 1;
    this.textContent = "";
    this.style = {};
    this.attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this._listeners = new Map();
    this.focused = false;
    this.classList = {
      contains: (c) => this.className.split(/\s+/).filter(Boolean).includes(c),
      add: (...cs) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const c of cs) set.add(c);
        this.className = Array.from(set).join(" ");
      },
      remove: (...cs) => {
        const rem = new Set(cs);
        this.className = this.className
          .split(/\s+/)
          .filter((c) => c && !rem.has(c))
          .join(" ");
      },
      toggle: (c, force) => {
        const has = this.classList.contains(c);
        const on = force !== undefined ? Boolean(force) : !has;
        if (on) this.classList.add(c);
        else this.classList.remove(c);
        return on;
      },
    };
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
    if (k === "id") this.id = String(v);
    if (k === "class") this.className = String(v);
    if (k === "type") this.type = String(v);
    if (k === "value") this.value = String(v);
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    if (
      this.tagName === "SELECT" &&
      c.tagName === "OPTION" &&
      this.children.length === 1 &&
      !this.value
    ) {
      this.value = c.value;
    }
    return c;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(n);
  }
  replaceChildren(...nodes) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(
        (c) => c !== this,
      );
      this.parentNode = null;
    }
  }
  focus() {
    this.focused = true;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    ev.stopPropagation = ev.stopPropagation || (() => {});
    ev.preventDefault = ev.preventDefault || (() => {});
    for (const fn of this._listeners.get(ev.type) || []) fn(ev);
  }
  set innerHTML(html) {
    this.children = [];
    this._rawInnerHtml = html;
    if (!html) return;
    const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
    const stack = [this];
    const voidTags = new Set(["input", "br", "hr"]);
    let m;
    while ((m = tagRegex.exec(html)) !== null) {
      const full = m[0];
      const tag = m[1].toLowerCase();
      const attrsStr = m[2];
      if (full.startsWith("</")) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const node = new ModalNode(tag);
      const idM = attrsStr.match(/\bid="([^"]*)"/);
      if (idM) node.id = idM[1];
      const clsM = attrsStr.match(/\bclass="([^"]*)"/);
      if (clsM) node.className = clsM[1];
      const valM = attrsStr.match(/\bvalue="([^"]*)"/);
      if (valM) node.value = valM[1];
      if (/\bdisabled\b/.test(attrsStr)) node.disabled = true;
      stack[stack.length - 1].appendChild(node);
      if (!full.endsWith("/>") && !voidTags.has(tag)) {
        stack.push(node);
      }
    }
  }
  _walk(fn) {
    for (const c of this.children) {
      fn(c);
      c._walk(fn);
    }
  }
  querySelector(sel) {
    let found = null;
    this._walk((n) => {
      if (found) return;
      if (sel.startsWith("#") && n.id === sel.slice(1)) found = n;
      else if (sel.startsWith(".") && n.classList.contains(sel.slice(1)))
        found = n;
    });
    return found;
  }
  querySelectorAll(sel) {
    const out = [];
    this._walk((n) => {
      if (sel.startsWith("#") && n.id === sel.slice(1)) out.push(n);
      else if (sel.startsWith(".") && n.classList.contains(sel.slice(1)))
        out.push(n);
    });
    return out;
  }
}

function installModalDom() {
  const body = new ModalNode("body");
  const docListeners = new Map();
  globalThis.document = {
    body,
    createElement: (t) => new ModalNode(t),
    getElementById: (id) => {
      let found = null;
      body._walk((n) => {
        if (!found && n.id === id) found = n;
      });
      return found;
    },
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = docListeners.get(type) || [];
      docListeners.set(
        type,
        list.filter((f) => f !== fn),
      );
    },
    dispatchEvent: (ev) => {
      ev.preventDefault = ev.preventDefault || (() => {});
      for (const fn of [...(docListeners.get(ev.type) || [])]) fn(ev);
    },
  };
  globalThis.requestAnimationFrame = (cb) => cb();
  return { body, docListeners };
}

const { openMdPatchModal } = await import("../editor/src/md-patch-modal.js");

test("md-patch-modal - patches files, allows toggling & remapping, and applies via Ctrl+Enter", async () => {
  installModalDom();

  const currentMd = [
    "### my_game/scripts/player.gd",
    "```gdscript",
    "var hp = 10",
    "```",
    "",
    "### my_game/models/box.scad",
    "```openscad",
    "cube(1);",
    "```",
  ].join("\n");

  const currentFilesMap = {
    "my_game/scripts/player.gd": "var hp = 10",
    "my_game/models/box.scad": "cube(1);",
  };

  let appliedResult = null;
  openMdPatchModal({
    currentMd,
    currentFilesMap,
    preferredTargetFile: "my_game/scripts/player.gd",
    initialPatchText: [
      "### scripts/player.gd",
      "```gdscript",
      "var hp = 25",
      "```",
      "",
      "### scripts/enemy.gd",
      "```gdscript",
      "extends Node3D",
      "```",
    ].join("\n"),
    onApply: async (res) => {
      appliedResult = res;
    },
  });

  const overlay = document.getElementById("mp-modal-overlay");
  assert.ok(overlay);
  assert.strictEqual(overlay.querySelector("#mp-mode-select").value, "patch");

  const items = overlay.querySelectorAll(".mp-item");
  assert.strictEqual(items.length, 2);

  const applyBtn = overlay.querySelector("#mp-apply-btn");
  assert.strictEqual(applyBtn.disabled, false);

  // Uncheck the second item (add enemy.gd)
  const secondCheckbox = items[1].children[0];
  secondCheckbox.checked = false;
  secondCheckbox.dispatchEvent({ type: "change" });

  // Apply via Ctrl+Enter
  document.dispatchEvent({ type: "keydown", key: "Enter", ctrlKey: true });
  await new Promise((r) => setImmediate(r));

  assert.ok(appliedResult);
  assert.strictEqual(appliedResult.mode, "patch");
  assert.strictEqual(appliedResult.appliedItems.length, 1);
  assert.strictEqual(
    appliedResult.appliedItems[0].targetPath,
    "my_game/scripts/player.gd",
  );
  assert.ok(appliedResult.updatedMd.includes("var hp = 25"));
  assert.ok(!appliedResult.updatedMd.includes("enemy.gd"));
  assert.strictEqual(document.getElementById("mp-modal-overlay"), null);
});

test("md-patch-modal - defaults to single-file for raw code and closes on Escape", () => {
  installModalDom();

  const currentMd = "### a.scad\n```openscad\ncube(1);\n```";
  openMdPatchModal({
    currentMd,
    currentFilesMap: { "a.scad": "cube(1);" },
    preferredTargetFile: "a.scad",
    initialPatchText: "sphere(5);",
  });

  const overlay = document.getElementById("mp-modal-overlay");
  assert.strictEqual(
    overlay.querySelector("#mp-mode-select").value,
    "single-file",
  );
  assert.strictEqual(overlay.querySelector("#mp-apply-btn").disabled, false);

  document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.strictEqual(document.getElementById("mp-modal-overlay"), null);
});
