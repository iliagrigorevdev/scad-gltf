import { generatePrompt } from "scad-gltf/prompt";
import {
  PROMPT_UI_HTML,
  setupPromptToggles,
  getSelectedPromptProfile,
  buildPromptFromUI,
} from "./prompt-ui.js";

console.log("🚀 SCAD Preview Extension loaded!");

window.addEventListener("message", (event) => {
  if (event.data) {
    if (event.data.type === "CLOSE_PREVIEW") {
      const container = document.getElementById("scad-preview-iframe");
      if (container) container.remove();
    } else if (event.data.type === "ADD_IMAGE_TO_CHAT") {
      addImageToChat(event.data.dataUrl);
    }
  }
});

async function addImageToChat(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], "preview.png", { type: "image/png" });

    // Target the exact AI Studio text area
    const chatInput =
      document.querySelector(
        'ms-prompt-box textarea[formcontrolname="promptText"]',
      ) ||
      document.querySelector("ms-prompt-box textarea") ||
      document.querySelector("textarea");

    if (chatInput) {
      chatInput.focus();

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });

      chatInput.dispatchEvent(pasteEvent);
    } else {
      console.warn("Could not find chat input to paste the image.");
    }
  } catch (err) {
    console.error("Error adding image to chat:", err);
  }
}

function insertActionButtonIntoCodeBlock(block, btn) {
  const existingActionBtn = block.querySelector(
    'button[aria-label*="copy" i], button[aria-label*="download" i], button[aria-label*="collapse" i], button[mattooltip*="copy" i], button[mattooltip*="download" i], button[mattooltip*="collapse" i], button[title*="Copy" i], button[title*="Download" i]',
  );

  const actionsContainer =
    existingActionBtn?.parentElement ||
    block.querySelector(".actions") ||
    block.querySelector(".header-actions") ||
    block.querySelector(".action-buttons") ||
    block.querySelector(".buttons") ||
    block.querySelector(".header") ||
    block.querySelector(".code-header");

  if (actionsContainer) {
    if (existingActionBtn) {
      actionsContainer.insertBefore(btn, existingActionBtn);
    } else {
      actionsContainer.prepend(btn);
    }
  } else {
    const preElement = block.querySelector("pre");
    if (preElement) {
      preElement.parentNode.insertBefore(btn, preElement);
    } else {
      block.appendChild(btn);
    }
  }
}

function createMdPreviewButton(extraClass = "") {
  const btn = document.createElement("button");
  btn.className = extraClass
    ? `md-preview-btn ${extraClass}`
    : "md-preview-btn";
  btn.title = "Preview Markdown";
  btn.setAttribute("aria-label", "Preview Markdown");
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="8" y1="13" x2="16" y2="13"></line>
      <line x1="8" y1="17" x2="13" y2="17"></line>
    </svg>
    <span>Preview MD</span>
  `;
  btn.onpointerdown = (e) => e.stopPropagation();
  btn.onmousedown = (e) => e.stopPropagation();
  return btn;
}

function getCodeBlockText(codeEl) {
  if (!codeEl) return "";
  if (!codeEl.querySelector("br")) {
    return codeEl.textContent || "";
  }
  const clone = codeEl.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return clone.textContent || "";
}

function getCodeBlockLanguage(block, codeEl) {
  const attrLang = (block.getAttribute("data-test-language") || "")
    .trim()
    .toLowerCase();
  if (attrLang && attrLang !== "none" && attrLang !== "plaintext") {
    return attrLang;
  }

  const classMatch = (codeEl?.className || "").match(/language-([^\s]+)/i);
  if (classMatch) {
    return classMatch[1].toLowerCase();
  }

  const headerLangEl = block.querySelector(
    ".language, .code-language, .code-header span, .header span",
  );
  if (headerLangEl && !headerLangEl.closest("button")) {
    const label = (headerLangEl.textContent || "").trim().toLowerCase();
    if (label && label !== "code" && !label.includes(" ")) {
      return label;
    }
  }
  return "";
}

function maxBacktickRun(text) {
  let maxRun = 0;
  const matches = String(text || "").match(/`+/g);
  if (matches) {
    for (const m of matches) {
      if (m.length > maxRun) maxRun = m.length;
    }
  }
  return maxRun;
}

function shouldSkipTurnNode(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = el.tagName;
  if (
    tag === "SCRIPT" ||
    tag === "STYLE" ||
    tag === "NOSCRIPT" ||
    tag === "BUTTON" ||
    tag === "MAT-ICON" ||
    tag === "SVG" ||
    tag === "MS-THOUGHT-CHUNK" ||
    tag === "MS-CHAT-TURN-OPTIONS" ||
    tag === "MS-GROUNDING-CHUNK"
  ) {
    return true;
  }
  const cls = el.classList;
  if (
    cls.contains("scad-preview-btn") ||
    cls.contains("md-preview-btn") ||
    cls.contains("md-preview-turn-bar") ||
    cls.contains("turn-footer") ||
    cls.contains("turn-header") ||
    cls.contains("actions-container") ||
    cls.contains("turn-actions") ||
    cls.contains("thought-container") ||
    cls.contains("thoughts-container") ||
    cls.contains("thinking-process") ||
    cls.contains("author-label") ||
    cls.contains("role-label") ||
    cls.contains("grounding-container")
  ) {
    return true;
  }
  return false;
}

function segmentsToMarkdown(segments) {
  let result = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "code") {
      if (result && !result.endsWith("\n")) {
        result += "\n";
      }
      // Keep single newline directly after a ### file header
      if (/\n###\s+[^\n]+\n\n$/.test(result)) {
        result = result.slice(0, -1);
      }
      result += seg.text;
      const next = segments[i + 1];
      if (next && !next.text.startsWith("\n")) {
        result += "\n\n";
      }
    } else {
      const cleaned = seg.text.replace(/\n{3,}/g, "\n\n");
      result += cleaned;
    }
  }
  return result.replace(/^\n+|\n+$/g, "");
}

function nodeToSegments(node, listDepth = 0) {
  if (!node) return [];
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.nodeValue || "";
    if (!raw) return [];
    if (/^[\s\r\n]+$/.test(raw)) {
      if (raw.includes("\n")) return [];
      return [{ kind: "md", text: " " }];
    }
    return [{ kind: "md", text: raw.replace(/\s+/g, " ") }];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node;
  if (shouldSkipTurnNode(el)) return [];

  const tag = el.tagName;

  if (tag === "MS-CODE-BLOCK") {
    const codeEl =
      el.querySelector("pre code") ||
      el.querySelector("code") ||
      el.querySelector("pre");
    const lang = getCodeBlockLanguage(el, codeEl);
    const codeText = getCodeBlockText(codeEl).replace(/\n$/, "");
    const fence = "`".repeat(Math.max(3, maxBacktickRun(codeText) + 1));
    return [{ kind: "code", text: `${fence}${lang}\n${codeText}\n${fence}` }];
  }

  if (tag === "PRE") {
    const codeEl = el.querySelector("code") || el;
    const classMatch = (codeEl.className || "").match(/language-([^\s]+)/i);
    const lang = classMatch ? classMatch[1].toLowerCase() : "";
    const codeText = getCodeBlockText(codeEl).replace(/\n$/, "");
    const fence = "`".repeat(Math.max(3, maxBacktickRun(codeText) + 1));
    return [{ kind: "code", text: `${fence}${lang}\n${codeText}\n${fence}` }];
  }

  const childrenSegments = () => {
    const out = [];
    for (const child of el.childNodes) {
      out.push(...nodeToSegments(child, listDepth));
    }
    return out;
  };

  if (/^H[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    const inner = segmentsToMarkdown(childrenSegments()).trim();
    if (!inner) return [];
    return [{ kind: "md", text: `\n\n${"#".repeat(level)} ${inner}\n\n` }];
  }

  if (tag === "P") {
    const segs = childrenSegments();
    const hasCode = segs.some((s) => s.kind === "code");
    if (hasCode) return segs;
    const inner = segmentsToMarkdown(segs).trim();
    if (!inner) return [];
    return [{ kind: "md", text: `\n\n${inner}\n\n` }];
  }

  if (tag === "BR") {
    return [{ kind: "md", text: "\n" }];
  }

  if (tag === "HR") {
    return [{ kind: "md", text: "\n\n---\n\n" }];
  }

  if (tag === "STRONG" || tag === "B") {
    const inner = segmentsToMarkdown(childrenSegments());
    if (!inner.trim()) return [{ kind: "md", text: inner }];
    return [{ kind: "md", text: `**${inner.trim()}**` }];
  }

  if (tag === "EM" || tag === "I") {
    const inner = segmentsToMarkdown(childrenSegments());
    if (!inner.trim()) return [{ kind: "md", text: inner }];
    return [{ kind: "md", text: `*${inner.trim()}*` }];
  }

  if (tag === "CODE") {
    const text = el.textContent || "";
    if (!text) return [];
    if (text.includes("`")) {
      return [{ kind: "md", text: "`` " + text + " ``" }];
    }
    return [{ kind: "md", text: "`" + text + "`" }];
  }

  if (tag === "A") {
    const href = el.getAttribute("href") || "";
    const inner = segmentsToMarkdown(childrenSegments()).trim();
    if (href && !href.startsWith("javascript:")) {
      return [{ kind: "md", text: `[${inner || href}](${href})` }];
    }
    return inner ? [{ kind: "md", text: inner }] : [];
  }

  if (tag === "BLOCKQUOTE") {
    const inner = segmentsToMarkdown(childrenSegments()).trim();
    if (!inner) return [];
    const quoted = inner
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    return [{ kind: "md", text: `\n\n${quoted}\n\n` }];
  }

  if (tag === "UL" || tag === "OL") {
    const isOrdered = tag === "OL";
    const items = [];
    let idx = 0;
    for (const child of el.children) {
      if (child.tagName !== "LI") continue;
      idx++;
      const prefix = `${"  ".repeat(listDepth)}${isOrdered ? `${idx}. ` : "- "}`;
      const liSegs = [];
      for (const liChild of child.childNodes) {
        liSegs.push(...nodeToSegments(liChild, listDepth + 1));
      }
      const liText = segmentsToMarkdown(liSegs);
      if (liText) {
        const lines = liText.split("\n");
        const formatted = lines
          .map((l, i) => (i === 0 ? `${prefix}${l}` : l))
          .join("\n");
        items.push(formatted);
      }
    }
    if (items.length === 0) return [];
    if (listDepth > 0) {
      return [{ kind: "md", text: `\n${items.join("\n")}` }];
    }
    return [{ kind: "md", text: `\n\n${items.join("\n")}\n\n` }];
  }

  if (tag === "TABLE") {
    const rows = Array.from(el.querySelectorAll("tr"));
    if (rows.length === 0) return [];
    const mdRows = rows.map((tr) => {
      const cells = Array.from(tr.children).map((cell) =>
        segmentsToMarkdown(nodeToSegments(cell, listDepth))
          .replace(/\n+/g, " ")
          .replace(/\|/g, "\\|")
          .trim(),
      );
      return `| ${cells.join(" | ")} |`;
    });
    const colCount = rows[0].children.length || 1;
    const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
    const tableLines = [mdRows[0], sep, ...mdRows.slice(1)];
    return [{ kind: "md", text: `\n\n${tableLines.join("\n")}\n\n` }];
  }

  return childrenSegments();
}

function getTurnContentRoot(turn) {
  return (
    turn.querySelector(".turn-content") ||
    turn.querySelector(".model-prompt-container") ||
    turn.querySelector(".chat-turn-container") ||
    turn
  );
}

function extractTurnMarkdown(turn) {
  const root = getTurnContentRoot(turn);
  if (!root) return "";

  const allBlocks = Array.from(root.querySelectorAll("ms-code-block")).filter(
    (b) => !b.closest("ms-thought-chunk"),
  );
  const mdBlocks = allBlocks.filter((b) => {
    const lang = getCodeBlockLanguage(
      b,
      b.querySelector("pre code") || b.querySelector("code"),
    );
    return lang === "markdown" || lang === "md";
  });

  if (mdBlocks.length === 1 && allBlocks.length === 1) {
    const codeEl =
      mdBlocks[0].querySelector("pre code") ||
      mdBlocks[0].querySelector("code") ||
      mdBlocks[0].querySelector("pre");
    const rawMd = getCodeBlockText(codeEl).trim();
    if (rawMd && (rawMd.includes("###") || rawMd.includes("```"))) {
      return rawMd;
    }
  }

  return segmentsToMarkdown(nodeToSegments(root));
}

function injectScadCodeBlockButtons() {
  const codeBlocks = document.querySelectorAll(
    'ms-code-block[data-test-language="openscad" i], ms-code-block[data-test-language="scad" i]',
  );

  codeBlocks.forEach((block) => {
    if (block.querySelector(".scad-preview-btn")) return;

    const btn = document.createElement("button");
    btn.className = "scad-preview-btn";
    btn.title = "Preview 3D";
    btn.setAttribute("aria-label", "Preview 3D");
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
        <line x1="12" y1="22.08" x2="12" y2="12"></line>
      </svg>
      <span>Preview 3D</span>
    `;

    btn.onpointerdown = (e) => e.stopPropagation();
    btn.onmousedown = (e) => e.stopPropagation();

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const codeElement =
        block.querySelector("pre code") || block.querySelector("code");
      if (codeElement) {
        openPreviewPanel(getCodeBlockText(codeElement));
      }
    };

    insertActionButtonIntoCodeBlock(block, btn);
  });
}

function injectMdCodeBlockButtons() {
  const mdBlocks = document.querySelectorAll(
    'ms-code-block[data-test-language="markdown" i], ms-code-block[data-test-language="md" i]',
  );

  mdBlocks.forEach((block) => {
    if (block.querySelector(".md-preview-btn")) return;

    const btn = createMdPreviewButton();
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const codeElement =
        block.querySelector("pre code") ||
        block.querySelector("code") ||
        block.querySelector("pre");
      if (codeElement) {
        await openInEditor(getCodeBlockText(codeElement));
      }
    };

    insertActionButtonIntoCodeBlock(block, btn);
  });
}

function isModelTurn(turn) {
  if (turn.querySelector('[data-turn-role="User"], .user-prompt-container')) {
    return false;
  }
  return Boolean(
    turn.querySelector(
      '[data-turn-role="Model"], .model-prompt-container, .chat-turn-container.model, ms-text-chunk, ms-cmark-node',
    ),
  );
}

function turnHasPreviewableContent(turn) {
  const root = getTurnContentRoot(turn);
  if (!root) return false;
  if (root.querySelector("ms-code-block")) {
    return true;
  }
  const chunks = root.querySelectorAll("ms-cmark-node, ms-text-chunk");
  for (const chunk of chunks) {
    if (chunk.closest("ms-thought-chunk")) continue;
    if ((chunk.textContent || "").trim().length > 0) return true;
  }
  return false;
}

function injectTurnMdPreviewButtons() {
  const turns = document.querySelectorAll("ms-chat-turn");
  turns.forEach((turn) => {
    if (!isModelTurn(turn) || !turnHasPreviewableContent(turn)) return;

    const candidateButtons = Array.from(
      turn.querySelectorAll(
        'button[aria-label*="More options" i], button[aria-label*="Rerun" i], button[aria-label*="Good response" i], button[aria-label*="Copy" i], button[aria-label*="Edit" i], button[mattooltip*="More" i], button[mattooltip*="Rerun" i], button[mattooltip*="Copy" i]',
      ),
    ).filter(
      (b) =>
        !b.closest("ms-code-block, ms-thought-chunk, .md-preview-turn-bar"),
    );

    const existingTurnActionBtn = candidateButtons[0] || null;
    const turnActionsContainer =
      existingTurnActionBtn?.parentElement ||
      Array.from(
        turn.querySelectorAll(
          "ms-chat-turn-options, .turn-footer, .turn-actions, .actions-container",
        ),
      ).find((el) => !el.closest("ms-code-block, ms-thought-chunk")) ||
      null;

    const existingBtn = turn.querySelector(".md-preview-turn-btn");
    if (existingBtn) {
      if (
        turnActionsContainer &&
        existingBtn.closest(".md-preview-turn-bar") &&
        !turnActionsContainer.contains(existingBtn)
      ) {
        const oldBar = existingBtn.closest(".md-preview-turn-bar");
        if (existingTurnActionBtn) {
          turnActionsContainer.insertBefore(existingBtn, existingTurnActionBtn);
        } else {
          turnActionsContainer.prepend(existingBtn);
        }
        if (oldBar) oldBar.remove();
      }
      return;
    }

    const btn = createMdPreviewButton("md-preview-turn-btn");
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const mdContent = extractTurnMarkdown(turn);
      if (mdContent && mdContent.trim()) {
        await openInEditor(mdContent);
      }
    };

    if (turnActionsContainer) {
      if (existingTurnActionBtn) {
        turnActionsContainer.insertBefore(btn, existingTurnActionBtn);
      } else {
        turnActionsContainer.prepend(btn);
      }
    } else {
      const bar = document.createElement("div");
      bar.className = "md-preview-turn-bar";
      bar.appendChild(btn);
      const targetRoot = getTurnContentRoot(turn);
      targetRoot.appendChild(bar);
    }
  });
}

// Watch the DOM for AI-generated code blocks and UI changes
const observer = new MutationObserver(() => {
  injectPromptButton();
  createPromptModal(); // Ensure modal exists in DOM
  injectScadCodeBlockButtons();
  injectMdCodeBlockButtons();
  injectTurnMdPreviewButtons();
});

observer.observe(document.body, { childList: true, subtree: true });

function injectPromptButton() {
  if (document.getElementById("scad-prompt-btn")) return;

  const btn = document.createElement("button");
  btn.id = "scad-prompt-btn";
  btn.innerText = "✨ SCAD";
  btn.className = "scad-prompt-btn";

  btn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Open our custom modal instead of window.prompt
    const modal = document.getElementById("scad-prompt-modal");
    if (modal) {
      const descInput = document.getElementById("scad-prompt-desc");
      if (descInput) {
        descInput.value = ""; // Clear text on every open
      }
      modal.style.display = "flex";

      if (descInput) {
        descInput.focus();
      }
    }
  };

  document.body.appendChild(btn);
}

function createPromptModal() {
  if (document.getElementById("scad-prompt-modal")) return;

  const modal = document.createElement("div");
  modal.id = "scad-prompt-modal";
  modal.className = "scad-modal-overlay";
  modal.style.display = "none";

  // Build the UI exactly like the viewer's prompt section
  modal.innerHTML = `
    <div class="scad-modal-content">
      <div class="scad-modal-header">
        <h3>✨ SCAD Prompt Generator</h3>
        <button id="scad-prompt-close" class="scad-modal-close">X</button>
      </div>
      <p class="scad-help-text">Describe the object you want to generate. The copied prompt will include advanced PBR and Animation rules based on your selection.</p>

      <div id="scad-prompt-backend-ui" class="scad-prompt-backend-ui">
        <div class="scad-prompt-backend-ui-header">
          <div class="scad-prompt-backend-ui-title">Refine Local Model:</div>
          <button id="scad-prompt-backend-connect" class="scad-prompt-backend-connect-btn">Connect</button>
        </div>
        <select id="scad-prompt-model-select">
          <option value="">-- Select a local model --</option>
        </select>
      </div>

      <div id="scad-prompt-ui-container"></div>

      <textarea id="scad-prompt-desc" rows="3" placeholder="e.g. A shiny gold ring with an embedded red gem"></textarea>

      <div class="scad-modal-actions">
        <button id="scad-prompt-submit" class="scad-primary-btn">📋 Generate & Paste</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Setup generic shared UI toggles with persistent per-profile states
  const uiContainer = document.getElementById("scad-prompt-ui-container");
  const helpTextEl = modal.querySelector(".scad-help-text");
  const descEl = document.getElementById("scad-prompt-desc");
  uiContainer.innerHTML = PROMPT_UI_HTML;
  setupPromptToggles(uiContainer, "scad_prompt_settings", {
    helpTextEl,
    descEl,
  });

  // Event Listeners for the Modal
  document.getElementById("scad-prompt-close").onclick = () =>
    (modal.style.display = "none");

  // Close when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
  };

  const connectBtn = document.getElementById("scad-prompt-backend-connect");
  const modelSelect = document.getElementById("scad-prompt-model-select");

  if (connectBtn && modelSelect) {
    connectBtn.onclick = async () => {
      try {
        connectBtn.innerText = "Connecting...";
        const res = await fetch("http://localhost:3000/api/scads");
        if (res.ok) {
          const data = await res.json();
          if (data.files && data.files.length > 0) {
            modelSelect.innerHTML =
              '<option value="">-- Select a local model --</option>';
            data.files.forEach((f) => {
              const opt = document.createElement("option");
              opt.value = f;
              opt.innerText = f;
              modelSelect.appendChild(opt);
            });
            modelSelect.style.display = "block";
            connectBtn.style.display = "none";
          } else {
            connectBtn.innerText = "No Models";
            setTimeout(() => {
              connectBtn.innerText = "Connect";
            }, 2000);
          }
        } else {
          connectBtn.innerText = "Failed";
          setTimeout(() => {
            connectBtn.innerText = "Connect";
          }, 2000);
        }
      } catch (err) {
        connectBtn.innerText = "Offline";
        setTimeout(() => {
          connectBtn.innerText = "Connect";
        }, 2000);
      }
    };
  }

  document.getElementById("scad-prompt-submit").onclick = async () => {
    const description = document
      .getElementById("scad-prompt-desc")
      .value.trim();
    const selectedModel = modelSelect ? modelSelect.value : "";

    if (!description && !selectedModel) {
      alert("Please enter a description or select a model!");
      return;
    }

    const profileId = getSelectedPromptProfile(uiContainer);
    let referenceFiles = [];
    let promptText = "";

    try {
      if (selectedModel) {
        const res = await fetch(
          "http://localhost:3000/api/scads/" +
            encodeURIComponent(selectedModel),
        );
        if (!res.ok) {
          throw new Error("Failed to load local model");
        }
        const data = await res.json();
        referenceFiles.push({ path: selectedModel, content: data.content });
      }

      if (profileId === "scad" && !description && referenceFiles.length > 0) {
        promptText = "```openscad\n" + referenceFiles[0].content + "\n```\n\n";
      } else {
        const effectiveDesc =
          description ||
          (referenceFiles.length > 0
            ? "Build a project incorporating and extending the provided OpenSCAD model"
            : "");
        promptText = buildPromptFromUI(uiContainer, effectiveDesc, {
          referenceFiles,
        });
      }

      // 2. Target the exact AI Studio text area based on your provided HTML
      const chatInput =
        document.querySelector(
          'ms-prompt-box textarea[formcontrolname="promptText"]',
        ) ||
        document.querySelector("ms-prompt-box textarea") ||
        document.querySelector("textarea");

      if (chatInput) {
        chatInput.focus();

        // Use document.execCommand if available (most reliable way to trigger Angular/React event listeners)
        const pasted = document.execCommand("insertText", false, promptText);

        // Fallback: If execCommand is blocked, use the native prototype setter and dispatch 'input'
        if (!pasted) {
          const currentVal = chatInput.value;
          const newVal = currentVal
            ? currentVal + "\n" + promptText
            : promptText;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value",
          ).set;
          nativeInputValueSetter.call(chatInput, newVal);
          chatInput.dispatchEvent(new Event("input", { bubbles: true }));
          chatInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      // 3. Always copy to clipboard as a backup
      await navigator.clipboard.writeText(promptText);

      // Close the modal and show temporary success on the main button
      modal.style.display = "none";
      if (modelSelect) modelSelect.value = "";
      if (chatInput) chatInput.focus();

      const btn = document.getElementById("scad-prompt-btn");
      const originalText = btn.innerText;
      btn.innerText = "✅ Prompt Pasted!";
      setTimeout(() => {
        btn.innerText = originalText;
      }, 2000);
    } catch (err) {
      console.error("Error generating/copying prompt:", err);
      alert("Error: " + err.message);
    }
  };
}

async function encodeCodeForUrl(code) {
  try {
    if (typeof CompressionStream !== "undefined") {
      const stream = new Blob([code])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
      const buffer = await new Response(stream).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return (
        "c" +
        btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
      );
    }
  } catch (e) {
    console.warn("CompressionStream failed, falling back", e);
  }
  return (
    "u" +
    btoa(unescape(encodeURIComponent(code)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

async function openInEditor(content) {
  if (!content || !content.trim()) return;
  const hash = await encodeCodeForUrl(content);
  const url = `https://iliagrigorevdev.github.io/scad-gltf/#${hash}`;
  window.open(url, "_blank");
  const existingContainer = document.getElementById("scad-preview-iframe");
  if (existingContainer) {
    existingContainer.remove();
  }
}

function openPreviewPanel(scadCode) {
  let existingContainer = document.getElementById("scad-preview-iframe");

  // Reuse existing iframe
  if (existingContainer) {
    existingContainer
      .querySelector("iframe")
      .contentWindow.postMessage({ type: "RENDER_SCAD", code: scadCode }, "*");
    return;
  }

  // Create container for iframe
  const container = document.createElement("div");
  container.id = "scad-preview-iframe";

  // Add close button
  const closeBtn = document.createElement("button");
  closeBtn.innerText = "X";
  closeBtn.className = "scad-close-btn";
  closeBtn.onclick = () => container.remove();

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("preview.html");

  // ✅ Grant fullscreen permissions to the iframe
  iframe.allow = "fullscreen";
  iframe.allowFullscreen = true;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("allow", "fullscreen");

  container.appendChild(closeBtn);
  container.appendChild(iframe);
  document.body.appendChild(container);

  // Wait for iframe to load, then pass SCAD code
  iframe.onload = () => {
    iframe.contentWindow.postMessage(
      { type: "RENDER_SCAD", code: scadCode },
      "*",
    );
  };
}
