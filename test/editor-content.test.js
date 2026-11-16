import test from "node:test";
import assert from "node:assert";
import { register } from "node:module";

const mockPromptUiCode = `
export const PROMPT_UI_HTML = "<div id=\\"mock-ui\\"></div>";
export function setupPromptToggles() {}
export function getSelectedPromptProfile() { return globalThis.__mockProfile || "scad"; }
export function buildPromptFromUI(_container, desc, opts) {
  const refCount = opts?.referenceFiles?.length || 0;
  return "PROMPT:" + desc + ":refs=" + refCount;
}
`;

const loaderSrc = `
const promptUiUrl = ${JSON.stringify("data:text/javascript," + encodeURIComponent(mockPromptUiCode))};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "./prompt-ui.js" && context.parentURL?.endsWith("/editor/src/content.js")) {
    return { shortCircuit: true, url: promptUiUrl };
  }
  return nextResolve(specifier, context);
}
`;

register(
  "data:text/javascript," + encodeURIComponent(loaderSrc),
  import.meta.url,
);

class FakeNode {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.id = "";
    this.className = "";
    this.attrs = new Map();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.innerText = "";
    this.textContent = "";
    this.value = "";
    this.src = "";
    this.title = "";
    this.allow = "";
    this.allowFullscreen = false;
    this.onclick = null;
    this.onload = null;
    this.focused = false;
    this.dispatchedEvents = [];
    this.contentWindow = {
      postedMessages: [],
      postMessage: (msg, target) => {
        this.contentWindow.postedMessages.push({ msg, target });
      },
    };
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
    if (k === "id") this.id = String(v);
    if (k === "class") this.className = String(v);
  }
  getAttribute(k) {
    return this.attrs.get(k) ?? null;
  }
  appendChild(child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  prepend(child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.unshift(child);
  }
  insertBefore(newNode, refNode) {
    newNode.parentNode = this;
    newNode.parentElement = this;
    const idx = this.children.indexOf(refNode);
    if (idx >= 0) this.children.splice(idx, 0, newNode);
    else this.children.push(newNode);
    return newNode;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(
        (c) => c !== this,
      );
      this.parentNode = null;
      this.parentElement = null;
    }
  }
  focus() {
    this.focused = true;
  }
  dispatchEvent(ev) {
    this.dispatchedEvents.push(ev);
    return true;
  }
  set innerHTML(html) {
    this.children = [];
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
      const node = new FakeNode(tag);
      const idM = attrsStr.match(/\bid="([^"]*)"/);
      if (idM) node.id = idM[1];
      const clsM = attrsStr.match(/\bclass="([^"]*)"/);
      if (clsM) node.className = clsM[1];
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
  querySelectorAll(sel) {
    const parts = sel
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const matches = [];
    this._walk((n) => {
      for (const p of parts) {
        if (p.startsWith("#") && n.id === p.slice(1)) {
          matches.push(n);
          break;
        }
        if (
          p.startsWith(".") &&
          n.className.split(/\s+/).includes(p.slice(1))
        ) {
          matches.push(n);
          break;
        }
        if (
          p.includes("ms-code-block[data-test-language=") &&
          n.tagName === "MS-CODE-BLOCK"
        ) {
          const lang = (
            n.getAttribute("data-test-language") || ""
          ).toLowerCase();
          if (lang === "openscad" || lang === "scad") {
            matches.push(n);
            break;
          }
        }
        if (
          p === "ms-prompt-box textarea" &&
          n.tagName === "TEXTAREA" &&
          n.parentNode?.tagName === "MS-PROMPT-BOX"
        ) {
          matches.push(n);
          break;
        }
        if (p === "textarea" && n.tagName === "TEXTAREA") {
          matches.push(n);
          break;
        }
        if (
          p.startsWith('button[aria-label*="copy"') &&
          n.tagName === "BUTTON"
        ) {
          if (
            (n.getAttribute("aria-label") || "").toLowerCase().includes("copy")
          ) {
            matches.push(n);
            break;
          }
        }
        if (n.tagName === p.toUpperCase()) {
          matches.push(n);
          break;
        }
      }
    });
    return matches;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

class FakeTextAreaElement extends FakeNode {
  constructor() {
    super("textarea");
    this._val = "";
  }
  get value() {
    return this._val;
  }
  set value(v) {
    this._val = v;
  }
}

const body = new FakeNode("body");
const windowListeners = new Map();

globalThis.window = {
  HTMLTextAreaElement: FakeTextAreaElement,
  addEventListener: (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(fn);
  },
};

globalThis.document = {
  body,
  createElement: (tag) =>
    tag.toLowerCase() === "textarea"
      ? new FakeTextAreaElement()
      : new FakeNode(tag),
  getElementById: (id) => {
    let found = null;
    body._walk((n) => {
      if (!found && n.id === id) found = n;
    });
    return found;
  },
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  execCommand: () => false,
};

let mutationCallback = null;
globalThis.MutationObserver = class {
  constructor(cb) {
    mutationCallback = cb;
  }
  observe() {}
};

globalThis.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://test-id/${p}`,
  },
};

const copiedTexts = [];
Object.defineProperty(globalThis, "navigator", {
  value: {
    clipboard: {
      writeText: async (txt) => {
        copiedTexts.push(txt);
      },
    },
  },
  configurable: true,
});

globalThis.alert = (msg) => {
  globalThis.__lastAlert = msg;
};

globalThis.DataTransfer = class {
  constructor() {
    this.files = [];
    this.items = {
      add: (file) => this.files.push(file),
    };
  }
};

globalThis.ClipboardEvent = class {
  constructor(type, init = {}) {
    this.type = type;
    this.clipboardData = init.clipboardData;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
  }
};

// Avoid 2-second dangling timers keeping the test process alive
globalThis.setTimeout = () => 0;

await import("../editor/src/content.js");

test("content.js - injects SCAD prompt UI and preview buttons on OpenSCAD code blocks", () => {
  const codeBlock = new FakeNode("ms-code-block");
  codeBlock.setAttribute("data-test-language", "openscad");
  const actionsDiv = new FakeNode("div");
  actionsDiv.className = "actions";
  const copyAction = new FakeNode("button");
  copyAction.setAttribute("aria-label", "Copy code");
  actionsDiv.appendChild(copyAction);
  const pre = new FakeNode("pre");
  const code = new FakeNode("code");
  code.textContent = "cube([10, 10, 10]);";
  pre.appendChild(code);
  codeBlock.appendChild(actionsDiv);
  codeBlock.appendChild(pre);
  body.appendChild(codeBlock);

  assert.ok(typeof mutationCallback === "function");
  mutationCallback();
  // Second mutation run should not duplicate buttons or modal
  mutationCallback();

  assert.ok(document.getElementById("scad-prompt-btn"));
  assert.ok(document.getElementById("scad-prompt-modal"));
  const previewBtns = codeBlock.querySelectorAll(".scad-preview-btn");
  assert.strictEqual(previewBtns.length, 1);
  assert.strictEqual(actionsDiv.children[0], previewBtns[0]);

  // Click Preview 3D button -> creates iframe and sends RENDER_SCAD on load
  let prevented = false;
  let stopped = false;
  previewBtns[0].onclick({
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.strictEqual(prevented, true);
  assert.strictEqual(stopped, true);

  const container = document.getElementById("scad-preview-iframe");
  assert.ok(container);
  const iframe = container.querySelector("iframe");
  assert.strictEqual(iframe.src, "chrome-extension://test-id/preview.html");
  assert.strictEqual(iframe.allowFullscreen, true);

  iframe.onload();
  assert.deepStrictEqual(iframe.contentWindow.postedMessages[0], {
    msg: {
      type: "RENDER_SCAD",
      code: "cube([10, 10, 10]);",
    },
    target: "*",
  });

  // Subsequent preview click reuses the existing iframe
  code.textContent = "sphere(5);";
  previewBtns[0].onclick({
    preventDefault: () => {},
    stopPropagation: () => {},
  });
  assert.deepStrictEqual(iframe.contentWindow.postedMessages[1], {
    msg: {
      type: "RENDER_SCAD",
      code: "sphere(5);",
    },
    target: "*",
  });
});

test("content.js - handles CLOSE_PREVIEW and ADD_IMAGE_TO_CHAT window messages", async (t) => {
  const promptBox = new FakeNode("ms-prompt-box");
  const chatInput = new FakeTextAreaElement();
  promptBox.appendChild(chatInput);
  body.appendChild(promptBox);

  t.mock.method(globalThis, "fetch", async () => ({
    blob: async () =>
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  }));

  const msgHandlers = windowListeners.get("message") || [];
  assert.ok(msgHandlers.length > 0);

  for (const fn of msgHandlers) {
    fn({
      data: {
        type: "ADD_IMAGE_TO_CHAT",
        dataUrl: "data:image/png;base64,AQID",
      },
    });
  }
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(chatInput.focused, true);
  assert.strictEqual(chatInput.dispatchedEvents.length, 1);
  assert.strictEqual(chatInput.dispatchedEvents[0].type, "paste");
  assert.strictEqual(
    chatInput.dispatchedEvents[0].clipboardData.files[0].name,
    "preview.png",
  );

  for (const fn of msgHandlers) {
    fn({ data: { type: "CLOSE_PREVIEW" } });
  }
  assert.strictEqual(document.getElementById("scad-preview-iframe"), null);
});

test("content.js - prompt modal connect and submit insert prompt and copy to clipboard", async (t) => {
  const promptBtn = document.getElementById("scad-prompt-btn");
  const modal = document.getElementById("scad-prompt-modal");
  const descEl = document.getElementById("scad-prompt-desc");
  descEl.value = "stale text";

  await promptBtn.onclick({
    preventDefault: () => {},
    stopPropagation: () => {},
  });
  assert.strictEqual(modal.style.display, "flex");
  assert.strictEqual(descEl.value, "");
  assert.strictEqual(descEl.focused, true);

  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "http://localhost:3000/api/scads") {
      return { ok: true, json: async () => ({ files: ["wheel.scad"] }) };
    }
    if (url === "http://localhost:3000/api/scads/wheel.scad") {
      return {
        ok: true,
        json: async () => ({ content: "cylinder(r=3, h=1);" }),
      };
    }
    return { ok: false };
  });

  const connectBtn = document.getElementById("scad-prompt-backend-connect");
  const modelSelect = document.getElementById("scad-prompt-model-select");
  await connectBtn.onclick();
  assert.strictEqual(modelSelect.style.display, "block");
  assert.strictEqual(connectBtn.style.display, "none");

  modelSelect.value = "wheel.scad";
  descEl.value = "Make a bigger wheel";
  globalThis.__mockProfile = "godot";

  const chatInput = body.querySelector("ms-prompt-box textarea");
  chatInput.value = "";
  await document.getElementById("scad-prompt-submit").onclick();

  assert.strictEqual(chatInput.value, "PROMPT:Make a bigger wheel:refs=1");
  assert.strictEqual(
    copiedTexts[copiedTexts.length - 1],
    "PROMPT:Make a bigger wheel:refs=1",
  );
  assert.strictEqual(modal.style.display, "none");
  assert.strictEqual(modelSelect.value, "");
});
