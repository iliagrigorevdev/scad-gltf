import { generatePrompt } from "openscad-gltf-wasm/prompt";

console.log("🚀 SCAD Preview Extension loaded!");

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLOSE_PREVIEW") {
    const container = document.getElementById("scad-preview-iframe");
    if (container) container.remove();
  }
});

// Watch the DOM for AI-generated code blocks and UI changes
const observer = new MutationObserver(() => {
  injectPromptButton();
  createPromptModal(); // Ensure modal exists in DOM

  const codeBlocks = document.querySelectorAll(
    'ms-code-block[data-test-language="openscad" i], ms-code-block[data-test-language="scad" i]',
  );

  codeBlocks.forEach((block) => {
    if (block.hasAttribute("data-scad-injected")) return;
    block.setAttribute("data-scad-injected", "true");

    const btn = document.createElement("button");
    btn.innerText = "👀 Preview 3D";
    btn.className = "scad-preview-btn";
    btn.style.margin = "0 0 10px 15px";

    btn.onpointerdown = (e) => e.stopPropagation();

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const codeElement = block.querySelector("code");
      if (codeElement) {
        openPreviewPanel(codeElement.innerText);
      }
    };

    const preElement = block.querySelector("pre");
    if (preElement) {
      preElement.parentNode.insertBefore(btn, preElement);
    } else {
      block.appendChild(btn);
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

  btn.onclick = (e) => {
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

      <div class="scad-prompt-toggles">
        <label><input type="checkbox" id="ext-opt-pbr-basic" checked /> Basic PBR</label>
        <label><input type="checkbox" id="ext-opt-pbr-autosmooth" checked /> Auto Smooth</label>
        <label><input type="checkbox" id="ext-opt-bake-colors" /> Bake Colors</label>
        <label><input type="checkbox" id="ext-opt-bake-normals" /> Bake Normals</label>
        <label><input type="checkbox" id="ext-opt-anim" checked /> Animations</label>
      </div>

      <div class="scad-prompt-group">
        <div class="scad-prompt-group-header">
          <span>Extended PBR</span>
          <label><input type="checkbox" id="ext-opt-pbr-all" checked /> Enable All</label>
        </div>
        <div class="scad-prompt-toggles nested">
          <label><input type="checkbox" class="ext-pbr-child" id="ext-opt-pbr-transmission" checked /> Transmission</label>
          <label><input type="checkbox" class="ext-pbr-child" id="ext-opt-pbr-clearcoat" checked /> Clearcoat</label>
          <label><input type="checkbox" class="ext-pbr-child" id="ext-opt-pbr-sheen" checked /> Sheen</label>
          <label><input type="checkbox" class="ext-pbr-child" id="ext-opt-pbr-emissive" checked /> Emissive</label>
          <label><input type="checkbox" class="ext-pbr-child" id="ext-opt-pbr-specular" checked /> Specular</label>
          <label><input type="checkbox" class="ext-pbr-child" id="ext-opt-pbr-iridescence" checked /> Iridescence</label>
        </div>
      </div>

      <textarea id="scad-prompt-desc" rows="3" placeholder="e.g. A shiny gold ring with an embedded red gem"></textarea>

      <div class="scad-modal-actions">
        <button id="scad-prompt-submit" class="scad-primary-btn">📋 Generate & Paste</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event Listeners for the Modal
  document.getElementById("scad-prompt-close").onclick = () =>
    (modal.style.display = "none");

  // Close when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
  };

  // Grouped Checkbox Logic
  const extPbrAll = document.getElementById("ext-opt-pbr-all");
  const extPbrChildren = document.querySelectorAll(".ext-pbr-child");

  const updatePbrAllState = () => {
    const allChecked = Array.from(extPbrChildren).every((c) => c.checked);
    const someChecked = Array.from(extPbrChildren).some((c) => c.checked);
    extPbrAll.checked = allChecked;
    extPbrAll.indeterminate = someChecked && !allChecked;
  };

  extPbrAll.addEventListener("change", (e) => {
    const checked = e.target.checked;
    extPbrChildren.forEach((cb) => (cb.checked = checked));
  });

  extPbrChildren.forEach((cb) => {
    cb.addEventListener("change", updatePbrAllState);
  });

  // --- Persist Options Logic ---
  const STORAGE_KEY = "scad_prompt_settings";

  const saveSettings = () => {
    const state = {};
    modal.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      state[cb.id] = cb.checked;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  };

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Restore Checkboxes Only
      modal.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        if (parsed[cb.id] !== undefined) {
          cb.checked = parsed[cb.id];
        }
      });
      updatePbrAllState(); // Recalculate indeterminate state
    }
  } catch (e) {
    console.warn("Could not load SCAD prompt settings", e);
  }

  // Listeners to auto-save to storage on option modifications
  modal.addEventListener("change", (e) => {
    if (e.target.type === "checkbox") saveSettings();
  });

  document.getElementById("scad-prompt-submit").onclick = async () => {
    const description = document
      .getElementById("scad-prompt-desc")
      .value.trim();
    if (!description) {
      alert("Please enter a description!");
      return;
    }

    const options = {
      basic: document.getElementById("ext-opt-pbr-basic").checked,
      transmission: document.getElementById("ext-opt-pbr-transmission").checked,
      clearcoat: document.getElementById("ext-opt-pbr-clearcoat").checked,
      sheen: document.getElementById("ext-opt-pbr-sheen").checked,
      emissive: document.getElementById("ext-opt-pbr-emissive").checked,
      specular: document.getElementById("ext-opt-pbr-specular").checked,
      iridescence: document.getElementById("ext-opt-pbr-iridescence").checked,
      autoSmoothAngle: document.getElementById("ext-opt-pbr-autosmooth")
        .checked,
      bakeColors: document.getElementById("ext-opt-bake-colors").checked,
      bakeNormals: document.getElementById("ext-opt-bake-normals").checked,
      animation: document.getElementById("ext-opt-anim").checked,
    };

    try {
      // 1. Generate the advanced LLM prompt via prompt.js
      const promptText = generatePrompt(description, options);

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
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value",
          ).set;
          nativeInputValueSetter.call(chatInput, promptText);
          chatInput.dispatchEvent(new Event("input", { bubbles: true }));
          chatInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      // 3. Always copy to clipboard as a backup
      await navigator.clipboard.writeText(promptText);

      // Close the modal and show temporary success on the main button
      modal.style.display = "none";
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
