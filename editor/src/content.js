import { generatePrompt } from "scad-gltf/prompt";
import {
  PROMPT_UI_HTML,
  setupPromptToggles,
  getPromptOptions,
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

// Watch the DOM for AI-generated code blocks and UI changes
const observer = new MutationObserver(() => {
  injectPromptButton();
  createPromptModal(); // Ensure modal exists in DOM

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

      const codeElement = block.querySelector("code");
      if (codeElement) {
        openPreviewPanel(codeElement.innerText);
      }
    };

    // Locate the header actions container near download, copy, and collapse icons
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
  });
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

  // Setup generic shared UI toggles with persistent states
  const uiContainer = document.getElementById("scad-prompt-ui-container");
  uiContainer.innerHTML = PROMPT_UI_HTML;
  setupPromptToggles(uiContainer, "scad_prompt_settings");

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

    const options = getPromptOptions(uiContainer);
    let promptText = "";

    try {
      if (description) {
        // 1. Generate the advanced LLM prompt via prompt.js
        promptText = generatePrompt(description, options);
      }

      if (selectedModel) {
        const res = await fetch(
          "http://localhost:3000/api/scads/" +
            encodeURIComponent(selectedModel),
        );
        if (res.ok) {
          const data = await res.json();
          const content = data.content;
          const codeBlock = "\`\`\`openscad\n" + content + "\n\`\`\`\n\n";

          if (promptText) {
            promptText += "\n\nReference code:\n" + codeBlock;
          } else {
            promptText = codeBlock;
          }
        } else {
          throw new Error("Failed to load local model");
        }
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
