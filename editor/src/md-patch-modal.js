import {
  computeLineDiff,
  buildUnifiedDisplayItems,
  createUnifiedDiffTable,
} from "./diff-utils.js";
import {
  analyzeMarkdownPatch,
  applyMarkdownPatchPlan,
  evaluatePatchEntryAgainstFiles,
} from "./md-utils.js";

export function openMdPatchModal({
  currentMd = "",
  currentFilesMap = {},
  preferredTargetFile = null,
  initialPatchText = "",
  clipboardNotice = "",
  onApply,
} = {}) {
  const existingOverlay = document.getElementById("mp-modal-overlay");
  if (existingOverlay) existingOverlay.remove();

  const existingPaths = Object.keys(currentFilesMap);
  const validPreferredTarget =
    preferredTargetFile && currentFilesMap[preferredTargetFile] !== undefined
      ? preferredTargetFile
      : existingPaths[0] || "";

  const overlay = document.createElement("div");
  overlay.id = "mp-modal-overlay";
  overlay.className = "mp-modal-overlay";

  overlay.innerHTML = `
    <div class="mp-modal" role="dialog" aria-modal="true" aria-label="Patch Markdown Project">
      <div class="mp-header">
        <div class="mp-header-left">
          <h3>🩹 Patch Markdown Project</h3>
          <select id="mp-mode-select" title="Choose how pasted content is applied">
            <option value="patch">Patch Matching & Add New</option>
            <option value="single-file">Replace Single File</option>
            <option value="replace">Replace Entire Document</option>
          </select>
          <select id="mp-single-target-select" style="display: none" title="Target file to replace"></select>
        </div>
        <button type="button" id="mp-close-btn" class="mp-close-btn" title="Close (Esc)">✕</button>
      </div>

      <div id="mp-notice" class="mp-notice" style="display: none"></div>

      <div class="mp-input-wrap">
        <div class="mp-input-toolbar">
          <span class="mp-input-hint">Paste AI output (<code>### filepath</code> blocks, <code>SEARCH/REPLACE</code> hunks, or raw file code) or drop a <code>.md</code>/<code>.patch</code> file</span>
          <div class="mp-input-actions">
            <button type="button" id="mp-paste-clip-btn">📋 Read Clipboard</button>
            <button type="button" id="mp-clear-btn">Clear</button>
          </div>
        </div>
        <textarea id="mp-input" spellcheck="false" placeholder="### scripts/player.gd&#10;\`\`\`gdscript&#10;...&#10;\`\`\`"></textarea>
      </div>

      <div class="mp-split">
        <div class="mp-list-pane">
          <div class="mp-pane-header">
            <span>Detected Changes</span>
            <span id="mp-list-counts" class="mp-list-counts"></span>
          </div>
          <div id="mp-list" class="mp-list"></div>
        </div>
        <div class="mp-diff-pane">
          <div class="mp-pane-header">
            <span id="mp-diff-title">Diff Preview</span>
            <span id="mp-diff-stats" class="vc-diff-stats"></span>
          </div>
          <div id="mp-diff-body" class="mp-diff-body"></div>
        </div>
      </div>

      <div class="mp-footer">
        <span id="mp-footer-summary" class="mp-footer-summary"></span>
        <div class="mp-footer-actions">
          <button type="button" id="mp-cancel-btn">Cancel</button>
          <button type="button" id="mp-apply-btn" class="primary" disabled>Apply Patch (Ctrl+Enter)</button>
        </div>
      </div>

      <datalist id="mp-existing-paths-datalist"></datalist>
    </div>
  `;

  document.body.appendChild(overlay);

  const modeSelect = overlay.querySelector("#mp-mode-select");
  const singleTargetSelect = overlay.querySelector("#mp-single-target-select");
  const closeBtn = overlay.querySelector("#mp-close-btn");
  const cancelBtn = overlay.querySelector("#mp-cancel-btn");
  const applyBtn = overlay.querySelector("#mp-apply-btn");
  const noticeEl = overlay.querySelector("#mp-notice");
  const pasteClipBtn = overlay.querySelector("#mp-paste-clip-btn");
  const clearBtn = overlay.querySelector("#mp-clear-btn");
  const inputEl = overlay.querySelector("#mp-input");
  const listEl = overlay.querySelector("#mp-list");
  const listCountsEl = overlay.querySelector("#mp-list-counts");
  const diffTitleEl = overlay.querySelector("#mp-diff-title");
  const diffStatsEl = overlay.querySelector("#mp-diff-stats");
  const diffBodyEl = overlay.querySelector("#mp-diff-body");
  const footerSummaryEl = overlay.querySelector("#mp-footer-summary");
  const datalistEl = overlay.querySelector("#mp-existing-paths-datalist");

  for (const p of existingPaths) {
    const opt = document.createElement("option");
    opt.value = p;
    singleTargetSelect.appendChild(opt);

    const dlOpt = document.createElement("option");
    dlOpt.value = p;
    datalistEl.appendChild(dlOpt);
  }
  if (validPreferredTarget) {
    singleTargetSelect.value = validPreferredTarget;
  }

  let currentItems = [];
  let selectedItemId = null;
  let userOverrodeMode = false;

  function showNotice(text, isWarning = true) {
    if (!text) {
      noticeEl.style.display = "none";
      noticeEl.textContent = "";
      return;
    }
    noticeEl.textContent = text;
    noticeEl.className = isWarning ? "mp-notice mp-notice-warn" : "mp-notice";
    noticeEl.style.display = "block";
  }

  if (clipboardNotice) {
    showNotice(clipboardNotice, true);
  }

  function autoChooseMode(analysis, rawText) {
    if (userOverrodeMode) return;
    if (analysis.entries.length > 0) {
      if (analysis.isLikelyFullProjectReplacement) {
        modeSelect.value = "replace";
      } else {
        modeSelect.value = "patch";
      }
    } else if (rawText.trim()) {
      if (validPreferredTarget) {
        modeSelect.value = "single-file";
      } else {
        modeSelect.value = "replace";
      }
    } else {
      modeSelect.value = "patch";
    }
  }

  function buildSingleFileItems(rawText) {
    const target = singleTargetSelect.value || validPreferredTarget;
    if (!target) return [];
    const entry = {
      filePath: target,
      isDelete: false,
      content: rawText.replace(/\r\n/g, "\n"),
      hunks: null,
    };
    return [
      evaluatePatchEntryAgainstFiles(entry, target, currentFilesMap, null),
    ];
  }

  function renderDiffPreview(item) {
    diffBodyEl.replaceChildren();
    diffStatsEl.replaceChildren();

    if (!item) {
      if (modeSelect.value === "replace" && inputEl.value.trim()) {
        diffTitleEl.textContent = "Full Document Diff";
        const diff = computeLineDiff(currentMd, inputEl.value);
        renderDiffTable(diff, diffBodyEl, diffStatsEl);
        return;
      }
      diffTitleEl.textContent = "Diff Preview";
      const empty = document.createElement("div");
      empty.className = "vc-empty-diff";
      empty.textContent =
        "Select a file change on the left to inspect its diff.";
      diffBodyEl.appendChild(empty);
      return;
    }

    diffTitleEl.textContent = `${item.targetPath}${item.isSearchReplace ? " (SEARCH/REPLACE)" : ""}`;

    if (item.error) {
      const errBox = document.createElement("div");
      errBox.className = "mp-error-box";
      errBox.textContent = item.error;
      diffBodyEl.appendChild(errBox);
      return;
    }

    const diff = computeLineDiff(
      item.previousContent || "",
      item.newContent || "",
    );
    renderDiffTable(diff, diffBodyEl, diffStatsEl);
  }

  function renderDiffTable(diff, container, statsEl) {
    if (diff.added === 0 && diff.removed === 0) {
      statsEl.innerHTML = `<span class="vc-stat-same">Identical</span>`;
      const empty = document.createElement("div");
      empty.className = "vc-empty-diff";
      empty.textContent = "No line changes.";
      container.appendChild(empty);
      return;
    }

    statsEl.innerHTML = `
      <span class="vc-stat-add">+${diff.added}</span>
      <span class="vc-stat-rem">-${diff.removed}</span>
    `;

    const items = buildUnifiedDisplayItems(diff.ops, false);
    const table = createUnifiedDiffTable(items);
    container.appendChild(table);
  }

  function updateSummaryAndApplyBtn() {
    const mode = modeSelect.value;
    if (mode === "replace") {
      const hasText = inputEl.value.length > 0 && inputEl.value !== currentMd;
      applyBtn.disabled = !hasText;
      applyBtn.textContent = "Replace Document (Ctrl+Enter)";
      footerSummaryEl.textContent = hasText
        ? "Replaces the entire editor content."
        : "Paste replacement Markdown or code.";
      listCountsEl.textContent = "Full replace";
      return;
    }

    const enabled = currentItems.filter(
      (i) => i.enabled && i.action !== "unchanged" && i.action !== "error",
    );
    const counts = { update: 0, add: 0, delete: 0, error: 0 };
    for (const item of currentItems) {
      if (item.action === "error") counts.error++;
      else if (item.enabled && counts[item.action] !== undefined) {
        counts[item.action]++;
      }
    }

    const parts = [];
    if (counts.update)
      parts.push(`${counts.update} update${counts.update > 1 ? "s" : ""}`);
    if (counts.add)
      parts.push(`${counts.add} addition${counts.add > 1 ? "s" : ""}`);
    if (counts.delete)
      parts.push(`${counts.delete} deletion${counts.delete > 1 ? "s" : ""}`);
    if (counts.error)
      parts.push(`${counts.error} error${counts.error > 1 ? "s" : ""}`);

    listCountsEl.textContent = parts.join(", ") || "0 changes";
    footerSummaryEl.textContent =
      enabled.length > 0
        ? `Ready to apply ${enabled.length} file change${enabled.length > 1 ? "s" : ""}.`
        : currentItems.length > 0
          ? "No actionable changes selected."
          : "Paste ### filepath blocks or raw code.";

    applyBtn.disabled = enabled.length === 0;
    applyBtn.textContent =
      enabled.length > 0
        ? `Apply ${enabled.length} Change${enabled.length > 1 ? "s" : ""} (Ctrl+Enter)`
        : "Apply Patch (Ctrl+Enter)";
  }

  function renderChangeList() {
    listEl.replaceChildren();
    const mode = modeSelect.value;

    if (mode === "replace") {
      const info = document.createElement("div");
      info.className = "vc-empty-diff";
      info.textContent =
        "Replace Entire Document mode is active. Inspect the full diff on the right.";
      listEl.appendChild(info);
      renderDiffPreview(null);
      updateSummaryAndApplyBtn();
      return;
    }

    if (currentItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vc-empty-diff";
      empty.textContent = inputEl.value.trim()
        ? "No ### filepath blocks detected. Switch mode to Replace Single File or Replace Entire Document."
        : "Paste patch text above to preview file changes.";
      listEl.appendChild(empty);
      renderDiffPreview(null);
      updateSummaryAndApplyBtn();
      return;
    }

    if (!currentItems.some((i) => i.id === selectedItemId)) {
      const firstActionable =
        currentItems.find((i) => i.action !== "unchanged") || currentItems[0];
      selectedItemId = firstActionable?.id || null;
    }

    for (const item of currentItems) {
      const row = document.createElement("div");
      row.className = "mp-item";
      if (item.id === selectedItemId) row.classList.add("selected");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(item.enabled);
      cb.disabled = item.action === "unchanged" || item.action === "error";
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        item.enabled = cb.checked;
        updateSummaryAndApplyBtn();
      });

      const badge = document.createElement("span");
      badge.className = `mp-badge mp-badge-${item.action}`;
      const badgeLabels = {
        update: "UPD",
        add: "ADD",
        delete: "DEL",
        unchanged: "SAME",
        error: "ERR",
      };
      badge.textContent = badgeLabels[item.action] || item.action.toUpperCase();

      const infoCol = document.createElement("div");
      infoCol.className = "mp-item-info";

      if (mode === "patch" && item.entry) {
        const pathInput = document.createElement("input");
        pathInput.type = "text";
        pathInput.className = "mp-path-input";
        pathInput.value = item.targetPath;
        pathInput.setAttribute("list", "mp-existing-paths-datalist");
        pathInput.title = "Edit target path in project";
        pathInput.addEventListener("click", (e) => e.stopPropagation());
        pathInput.addEventListener("change", () => {
          const nextPath = pathInput.value.trim();
          if (!nextPath) {
            pathInput.value = item.targetPath;
            return;
          }
          const updated = evaluatePatchEntryAgainstFiles(
            item.entry,
            nextPath,
            currentFilesMap,
            nextPath !== item.sourcePath ? item.sourcePath : null,
          );
          updated.entry = item.entry;
          updated.id = item.id;
          const idx = currentItems.indexOf(item);
          if (idx !== -1) currentItems[idx] = updated;
          renderChangeList();
        });
        infoCol.appendChild(pathInput);
      } else {
        const pathSpan = document.createElement("span");
        pathSpan.className = "mp-path-label";
        pathSpan.textContent = item.targetPath;
        infoCol.appendChild(pathSpan);
      }

      if (item.remappedFrom && item.remappedFrom !== item.targetPath) {
        const sub = document.createElement("div");
        sub.className = "mp-item-sub";
        sub.textContent = `mapped from ${item.remappedFrom}`;
        infoCol.appendChild(sub);
      } else if (item.error) {
        const sub = document.createElement("div");
        sub.className = "mp-item-sub mp-item-sub-err";
        sub.textContent = item.error;
        infoCol.appendChild(sub);
      }

      const diff = computeLineDiff(
        item.previousContent || "",
        item.newContent || "",
      );
      const stats = document.createElement("span");
      stats.className = "mp-item-stats";
      if (item.action === "error") {
        stats.textContent = "!";
      } else {
        stats.innerHTML = `<span class="vc-stat-add">+${diff.added}</span> <span class="vc-stat-rem">-${diff.removed}</span>`;
      }

      row.append(cb, badge, infoCol, stats);
      row.addEventListener("click", () => {
        selectedItemId = item.id;
        renderChangeList();
      });

      listEl.appendChild(row);
    }

    const activeItem =
      currentItems.find((i) => i.id === selectedItemId) || null;
    renderDiffPreview(activeItem);
    updateSummaryAndApplyBtn();
  }

  function refreshAnalysis() {
    const rawText = inputEl.value;
    const analysis = analyzeMarkdownPatch(currentMd, rawText, {
      existingFilesMap: currentFilesMap,
    });
    autoChooseMode(analysis, rawText);

    const mode = modeSelect.value;
    singleTargetSelect.style.display =
      mode === "single-file" ? "inline-flex" : "none";

    if (mode === "patch") {
      currentItems = analysis.items;
    } else if (mode === "single-file") {
      currentItems = rawText.length > 0 ? buildSingleFileItems(rawText) : [];
    } else {
      currentItems = [];
    }

    renderChangeList();
  }

  function closeModal() {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  }

  async function handleApply() {
    if (applyBtn.disabled) return;
    const mode = modeSelect.value;

    if (mode === "replace") {
      closeModal();
      if (onApply) {
        await onApply({
          mode: "replace",
          updatedMd: inputEl.value,
          appliedItems: [],
          rawText: inputEl.value,
        });
      }
      return;
    }

    const { updatedMd, appliedItems } = applyMarkdownPatchPlan(
      currentMd,
      currentItems,
    );
    if (appliedItems.length === 0) return;

    closeModal();
    if (onApply) {
      await onApply({
        mode,
        updatedMd,
        appliedItems,
        rawText: inputEl.value,
      });
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      closeModal();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleApply();
    }
  }

  document.addEventListener("keydown", onKeyDown);
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  modeSelect.addEventListener("change", () => {
    userOverrodeMode = true;
    refreshAnalysis();
  });

  singleTargetSelect.addEventListener("change", () => {
    if (modeSelect.value === "single-file") {
      refreshAnalysis();
    }
  });

  inputEl.addEventListener("input", refreshAnalysis);

  inputEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  inputEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  inputEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    inputEl.value = await file.text();
    userOverrodeMode = false;
    refreshAnalysis();
  });

  pasteClipBtn.addEventListener("click", async () => {
    try {
      const clip = await navigator.clipboard.readText();
      inputEl.value = clip;
      userOverrodeMode = false;
      showNotice("", false);
      refreshAnalysis();
    } catch {
      showNotice(
        "Clipboard access was blocked — press Ctrl+V / Cmd+V inside the text area below.",
        true,
      );
      inputEl.focus();
    }
  });

  clearBtn.addEventListener("click", () => {
    inputEl.value = "";
    userOverrodeMode = false;
    refreshAnalysis();
    inputEl.focus();
  });

  applyBtn.addEventListener("click", handleApply);

  if (initialPatchText) {
    inputEl.value = initialPatchText;
    refreshAnalysis();
  } else {
    refreshAnalysis();
    if (navigator.clipboard?.readText) {
      navigator.clipboard
        .readText()
        .then((clip) => {
          if (clip && !inputEl.value) {
            inputEl.value = clip;
            refreshAnalysis();
          }
        })
        .catch(() => {});
    }
  }

  requestAnimationFrame(() => inputEl.focus());
}
