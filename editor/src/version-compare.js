import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { disposeThreeObject, parseGlbBuffer } from "./viewer-core.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { convertScadToGltf } from "scad-gltf/convert";
import wasmUrl from "scad-gltf/openscad.wasm?url";
import {
  hashString,
  getUtf8ByteLength,
  formatBytes,
  getContentFileMap,
  computeLineDiff,
  buildUnifiedDisplayItems,
  buildSideBySideRows,
  createUnifiedDiffTable,
  extractScadEntries,
  resolveScadCompilationInput,
} from "./diff-utils.js";
import {
  computeModelBounds,
  fitCameraToBox,
  setupMeshShadowsAndWireframe,
} from "./shared.js";
import {
  DRAFT_MODEL_ID,
  loadActiveWorkspaceSync,
  getLocalModels,
  getLocalModel,
  getModelVersions,
  formatVersionTimestamp,
} from "./local-store.js";

const CURRENT_EDITOR_VALUE = "__current__";
const LATEST_SAVED_VALUE = "__saved__";

const compiledGlbCache = new Map();

async function compileContentToGlb(content, preferredScadPath, fetchDepsFn) {
  const { entryCode, extractedAdditionalFiles, targetScadPath } =
    resolveScadCompilationInput(content, preferredScadPath);

  if (!entryCode || !entryCode.trim()) {
    return null;
  }

  const cacheKey = `${hashString(content)}::${targetScadPath || ""}`;
  if (compiledGlbCache.has(cacheKey)) {
    return compiledGlbCache.get(cacheKey);
  }

  const additionalFiles = fetchDepsFn ? await fetchDepsFn(entryCode) : {};
  Object.assign(additionalFiles, extractedAdditionalFiles);

  const glbData = await convertScadToGltf(entryCode, {
    wasmUrl,
    additionalFiles,
  });

  if (compiledGlbCache.size > 24) {
    const oldestKey = compiledGlbCache.keys().next().value;
    compiledGlbCache.delete(oldestKey);
  }
  compiledGlbCache.set(cacheKey, glbData);
  return glbData;
}

async function parseGlbToGroup(gltfData) {
  const gltf = await parseGlbBuffer(gltfData);
  return gltf.scene;
}

function cloneWithTint(
  sourceGroup,
  hexColor,
  opacity,
  depthWrite,
  isWireframe,
) {
  const cloned = sourceGroup.clone(true);
  const tintMat = new THREE.MeshStandardMaterial({
    color: hexColor,
    roughness: 0.55,
    metalness: 0.1,
    transparent: true,
    opacity,
    depthWrite,
    wireframe: Boolean(isWireframe),
    side: THREE.DoubleSide,
  });

  cloned.traverse((child) => {
    if (child.isMesh) {
      child.material = tintMat.clone();
      child.castShadow = false;
      child.receiveShadow = false;
      child.frustumCulled = false;
    }
  });
  tintMat.dispose();
  return cloned;
}

function createCompareScene(envTexture) {
  const scn = new THREE.Scene();
  scn.background = new THREE.Color(0x161616);
  if (envTexture) {
    scn.environment = envTexture;
    scn.environmentIntensity = 0.85;
  }

  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(60, 90, -60);
  scn.add(dir);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
  hemi.position.set(0, 30, 0);
  scn.add(hemi);

  const grid = new THREE.GridHelper(1000, 60, 0x555555, 0x2d2d2d);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scn.add(grid);

  const axes = new THREE.AxesHelper(60);
  scn.add(axes);

  return { scene: scn, dirLight: dir, grid, axes };
}

export async function openVersionCompareModal({
  activeModelId = DRAFT_MODEL_ID,
  selectedVersionId = "",
  currentName = "",
  currentContent = "",
  currentEntryFile = null,
  fetchDependencies = null,
  onRestore = null,
}) {
  const existingOverlay = document.getElementById("vc-modal-overlay");
  if (existingOverlay) existingOverlay.remove();

  // Gather all available models and their persisted versions
  const savedModels = await getLocalModels();
  const draftVersions = await getModelVersions(DRAFT_MODEL_ID);
  const savedDraftSync = loadActiveWorkspaceSync();
  const hasDraft =
    activeModelId === DRAFT_MODEL_ID ||
    draftVersions.length > 0 ||
    Boolean(savedDraftSync && savedDraftSync.content);

  const modelCatalog = [];
  if (hasDraft) {
    modelCatalog.push({
      id: DRAFT_MODEL_ID,
      label: "Active Draft",
    });
  }
  for (const m of savedModels) {
    modelCatalog.push({
      id: m.id,
      label: m.name || "Untitled Model",
    });
  }

  if (modelCatalog.length === 0) {
    modelCatalog.push({ id: DRAFT_MODEL_ID, label: "Active Draft" });
  }

  const modelVersionsCache = new Map();
  const modelRecordCache = new Map();

  async function loadModelState(modelId) {
    if (!modelVersionsCache.has(modelId)) {
      const vers = await getModelVersions(modelId);
      modelVersionsCache.set(modelId, vers);
    }
    if (!modelRecordCache.has(modelId)) {
      let rec = null;
      if (modelId === DRAFT_MODEL_ID) {
        rec =
          activeModelId === DRAFT_MODEL_ID
            ? {
                id: DRAFT_MODEL_ID,
                name: currentName,
                content: currentContent,
                entryFile: currentEntryFile,
                updatedAt: Date.now(),
              }
            : savedDraftSync;
      } else {
        rec = await getLocalModel(modelId);
      }
      modelRecordCache.set(modelId, rec);
    }
    return {
      versions: modelVersionsCache.get(modelId) || [],
      record: modelRecordCache.get(modelId) || null,
    };
  }

  async function getVersionOptionsForModel(modelId) {
    const { versions, record } = await loadModelState(modelId);
    const items = [];

    if (modelId === activeModelId) {
      items.push({
        value: CURRENT_EDITOR_VALUE,
        label: `Current Editor (${currentContent ? currentContent.split("\n").length : 0}L)`,
        snapshot: {
          id: CURRENT_EDITOR_VALUE,
          modelId,
          name: currentName,
          content: currentContent,
          entryFile: currentEntryFile,
          createdAt: Date.now(),
          kind: "live",
          label: "Current Editor",
          lineCount: currentContent ? currentContent.split("\n").length : 0,
          byteLength: getUtf8ByteLength(currentContent || ""),
        },
      });
    } else if (record) {
      const c = record.content || "";
      items.push({
        value: LATEST_SAVED_VALUE,
        label: `Latest Saved (${c ? c.split("\n").length : 0}L)`,
        snapshot: {
          id: LATEST_SAVED_VALUE,
          modelId,
          name: record.name || "",
          content: c,
          entryFile: record.entryFile || null,
          createdAt: record.updatedAt || Date.now(),
          kind: "saved",
          label: "Latest Saved",
          lineCount: c ? c.split("\n").length : 0,
          byteLength: getUtf8ByteLength(c),
        },
      });
    }

    for (const v of versions) {
      const kindTag = v.kind === "manual" ? "Manual" : "Auto";
      const notePart = v.label ? ` "${v.label}"` : "";
      const timeStr = formatVersionTimestamp(v.createdAt);
      items.push({
        value: v.id,
        label: `v${v.versionNumber} [${kindTag}]${notePart} • ${timeStr} (${v.lineCount}L)`,
        snapshot: v,
      });
    }

    return items;
  }

  // Build modal DOM
  const overlay = document.createElement("div");
  overlay.id = "vc-modal-overlay";
  overlay.className = "vc-modal-overlay";

  overlay.innerHTML = `
    <div class="vc-modal" role="dialog" aria-modal="true" aria-label="Compare Persisted Versions">
      <div class="vc-header">
        <div class="vc-header-left">
          <h3>Compare Persisted Versions</h3>
          <div class="vc-tab-group">
            <button type="button" id="vc-tab-code" class="vc-tab-btn active">📝 Code Diff</button>
            <button type="button" id="vc-tab-3d" class="vc-tab-btn">🧊 3D Visual</button>
          </div>
        </div>
        <button type="button" id="vc-close-btn" class="vc-close-btn" title="Close (Esc)">✕</button>
      </div>

      <div class="vc-selectors-bar">
        <div class="vc-side-picker">
          <div class="vc-side-label">
            <span class="vc-badge vc-badge-a">A (Base)</span>
            <span id="vc-meta-a" class="vc-meta-text"></span>
          </div>
          <div class="vc-side-controls">
            <select id="vc-model-a" title="Select Model A"></select>
            <select id="vc-version-a" title="Select Version A"></select>
            <button type="button" id="vc-restore-a" class="vc-restore-btn" title="Restore Version A into editor">↩ Restore A</button>
          </div>
        </div>

        <button type="button" id="vc-swap-btn" class="vc-swap-btn" title="Swap A and B">⇄</button>

        <div class="vc-side-picker">
          <div class="vc-side-label">
            <span class="vc-badge vc-badge-b">B (Compare)</span>
            <span id="vc-meta-b" class="vc-meta-text"></span>
          </div>
          <div class="vc-side-controls">
            <select id="vc-model-b" title="Select Model B"></select>
            <select id="vc-version-b" title="Select Version B"></select>
            <button type="button" id="vc-restore-b" class="vc-restore-btn" title="Restore Version B into editor">↩ Restore B</button>
          </div>
        </div>
      </div>

      <div id="vc-code-section" class="vc-section">
        <div class="vc-toolbar">
          <div id="vc-diff-stats" class="vc-diff-stats"></div>
          <div class="vc-toolbar-right">
            <select id="vc-file-filter" style="display: none" title="Filter by file inside Markdown project"></select>
            <div class="vc-mode-toggle">
              <button type="button" id="vc-mode-split" class="vc-mode-btn active">Side-by-Side</button>
              <button type="button" id="vc-mode-unified" class="vc-mode-btn">Unified</button>
            </div>
            <label class="vc-checkbox-label">
              <input type="checkbox" id="vc-full-file-cb" /> Full file
            </label>
          </div>
        </div>
        <div id="vc-diff-body" class="vc-diff-body"></div>
      </div>

      <div id="vc-3d-section" class="vc-section" style="display: none">
        <div class="vc-toolbar">
          <div class="vc-3d-controls-left">
            <select id="vc-3d-mode" title="3D comparison layout">
              <option value="side-by-side">Side-by-Side (Synced Camera)</option>
              <option value="overlay">Overlay (Red = A, Green = B)</option>
            </select>
            <select id="vc-3d-scad-select" style="display: none" title="Select .scad file to render"></select>
            <label class="vc-checkbox-label">
              <input type="checkbox" id="vc-3d-wireframe-cb" /> Wireframe
            </label>
            <button type="button" id="vc-3d-fit-btn">🎯 Fit Camera</button>
          </div>
          <div id="vc-3d-status" class="vc-3d-status">Select 3D Visual tab to compile and compare</div>
        </div>
        <div id="vc-3d-viewport" class="vc-3d-viewport">
          <div id="vc-3d-divider" class="vc-3d-divider"></div>
          <div id="vc-3d-label-a" class="vc-3d-corner-label left">A</div>
          <div id="vc-3d-label-b" class="vc-3d-corner-label right">B</div>
          <div id="vc-3d-legend" class="vc-3d-legend" style="display: none">
            <span class="vc-legend-a">■ A (Base)</span>
            <span class="vc-legend-b">■ B (Compare)</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Elements
  const closeBtn = overlay.querySelector("#vc-close-btn");
  const tabCodeBtn = overlay.querySelector("#vc-tab-code");
  const tab3dBtn = overlay.querySelector("#vc-tab-3d");
  const codeSection = overlay.querySelector("#vc-code-section");
  const threeSection = overlay.querySelector("#vc-3d-section");

  const modelASelect = overlay.querySelector("#vc-model-a");
  const versionASelect = overlay.querySelector("#vc-version-a");
  const restoreABtn = overlay.querySelector("#vc-restore-a");
  const metaAEl = overlay.querySelector("#vc-meta-a");

  const modelBSelect = overlay.querySelector("#vc-model-b");
  const versionBSelect = overlay.querySelector("#vc-version-b");
  const restoreBBtn = overlay.querySelector("#vc-restore-b");
  const metaBEl = overlay.querySelector("#vc-meta-b");

  const swapBtn = overlay.querySelector("#vc-swap-btn");
  const diffStatsEl = overlay.querySelector("#vc-diff-stats");
  const fileFilterSelect = overlay.querySelector("#vc-file-filter");
  const modeSplitBtn = overlay.querySelector("#vc-mode-split");
  const modeUnifiedBtn = overlay.querySelector("#vc-mode-unified");
  const fullFileCb = overlay.querySelector("#vc-full-file-cb");
  const diffBodyEl = overlay.querySelector("#vc-diff-body");

  const threeModeSelect = overlay.querySelector("#vc-3d-mode");
  const threeScadSelect = overlay.querySelector("#vc-3d-scad-select");
  const threeWireframeCb = overlay.querySelector("#vc-3d-wireframe-cb");
  const threeFitBtn = overlay.querySelector("#vc-3d-fit-btn");
  const threeStatusEl = overlay.querySelector("#vc-3d-status");
  const threeViewportEl = overlay.querySelector("#vc-3d-viewport");
  const threeDividerEl = overlay.querySelector("#vc-3d-divider");
  const threeLabelAEl = overlay.querySelector("#vc-3d-label-a");
  const threeLabelBEl = overlay.querySelector("#vc-3d-label-b");
  const threeLegendEl = overlay.querySelector("#vc-3d-legend");

  let activeTab = "code";
  let diffLayout = "split";
  let sideAOptions = [];
  let sideBOptions = [];
  let snapshotA = null;
  let snapshotB = null;

  // 3D state (lazily initialized on first 3D tab open)
  let threeInitialized = false;
  let threeRenderer = null;
  let threeCamera = null;
  let threeControls = null;
  let threePmrem = null;
  let threeEnvTex = null;
  let threeSceneObjA = null;
  let threeSceneObjB = null;
  let threeSceneObjOverlay = null;
  let meshGroupA = null;
  let meshGroupB = null;
  let overlayGroupA = null;
  let overlayGroupB = null;
  let animFrameId = null;
  let resizeObserver = null;
  let renderToken = 0;

  function populateModelSelect(selectEl, defaultId) {
    selectEl.innerHTML = "";
    for (const m of modelCatalog) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent =
        m.id === activeModelId ? `${m.label} (Active)` : m.label;
      selectEl.appendChild(opt);
    }
    if (modelCatalog.some((m) => m.id === defaultId)) {
      selectEl.value = defaultId;
    }
  }

  async function refreshSideVersions(side, preferredValue = null) {
    const modelSelect = side === "A" ? modelASelect : modelBSelect;
    const versionSelect = side === "A" ? versionASelect : versionBSelect;
    const modelId = modelSelect.value;
    const options = await getVersionOptionsForModel(modelId);

    if (side === "A") sideAOptions = options;
    else sideBOptions = options;

    versionSelect.innerHTML = "";
    if (options.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "-- No versions --";
      versionSelect.appendChild(opt);
    } else {
      for (const item of options) {
        const opt = document.createElement("option");
        opt.value = item.value;
        opt.textContent = item.label;
        versionSelect.appendChild(opt);
      }
      if (preferredValue && options.some((o) => o.value === preferredValue)) {
        versionSelect.value = preferredValue;
      } else {
        versionSelect.value = options[0].value;
      }
    }
  }

  function resolveSelectedSnapshot(side) {
    const options = side === "A" ? sideAOptions : sideBOptions;
    const selectEl = side === "A" ? versionASelect : versionBSelect;
    const found = options.find((o) => o.value === selectEl.value);
    return found ? found.snapshot : null;
  }

  function updateMetaDisplay(side, snapshot) {
    const metaEl = side === "A" ? metaAEl : metaBEl;
    const restoreBtn = side === "A" ? restoreABtn : restoreBBtn;
    if (!snapshot) {
      metaEl.textContent = "Empty";
      restoreBtn.disabled = true;
      return;
    }
    const lineCount = snapshot.content
      ? snapshot.content.split("\n").length
      : 0;
    const byteLen = getUtf8ByteLength(snapshot.content || "");
    const timePart = snapshot.createdAt
      ? ` • ${formatVersionTimestamp(snapshot.createdAt)}`
      : "";
    metaEl.textContent = `${lineCount}L • ${formatBytes(byteLen)}${timePart}`;
    restoreBtn.disabled =
      snapshot.id === CURRENT_EDITOR_VALUE &&
      snapshot.modelId === activeModelId;
  }

  function updateFileFilterOptions() {
    const mapA = getContentFileMap(snapshotA?.content || "");
    const mapB = getContentFileMap(snapshotB?.content || "");

    if (!mapA && !mapB) {
      fileFilterSelect.style.display = "none";
      fileFilterSelect.innerHTML = "";
      return;
    }

    const prevVal = fileFilterSelect.value;
    const allPaths = Array.from(
      new Set([...Object.keys(mapA || {}), ...Object.keys(mapB || {})]),
    ).sort((a, b) => a.localeCompare(b));

    fileFilterSelect.innerHTML =
      '<option value="__all__">All Files (Raw Document)</option>';

    for (const p of allPaths) {
      const contentA = mapA?.[p];
      const contentB = mapB?.[p];
      let tag = "=";
      if (contentA === undefined) tag = "+";
      else if (contentB === undefined) tag = "-";
      else if (contentA !== contentB) tag = "~";

      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = `[${tag}] ${p}`;
      fileFilterSelect.appendChild(opt);
    }

    if (prevVal && (prevVal === "__all__" || allPaths.includes(prevVal))) {
      fileFilterSelect.value = prevVal;
    } else {
      fileFilterSelect.value = "__all__";
    }
    fileFilterSelect.style.display = "flex";
  }

  function renderCodeDiff() {
    let textA = snapshotA?.content ?? "";
    let textB = snapshotB?.content ?? "";

    if (
      fileFilterSelect.style.display !== "none" &&
      fileFilterSelect.value &&
      fileFilterSelect.value !== "__all__"
    ) {
      const targetPath = fileFilterSelect.value;
      const mapA = getContentFileMap(textA) || {};
      const mapB = getContentFileMap(textB) || {};
      textA = mapA[targetPath] ?? "";
      textB = mapB[targetPath] ?? "";
    }

    const diff = computeLineDiff(textA, textB);
    const isIdentical = diff.added === 0 && diff.removed === 0;

    if (isIdentical) {
      diffStatsEl.innerHTML = `<span class="vc-stat-same">✓ Identical (${diff.unchanged} lines)</span>`;
    } else {
      diffStatsEl.innerHTML = `
        <span class="vc-stat-add">+${diff.added} added</span>
        <span class="vc-stat-rem">-${diff.removed} removed</span>
        <span class="vc-stat-same">${diff.unchanged} unchanged</span>
      `;
    }

    diffBodyEl.replaceChildren();

    if (isIdentical && !fullFileCb.checked) {
      const empty = document.createElement("div");
      empty.className = "vc-empty-diff";
      empty.textContent =
        "Selected versions have identical content. Check 'Full file' to inspect lines.";
      diffBodyEl.appendChild(empty);
      return;
    }

    const showFull = fullFileCb.checked;
    let table;

    if (diffLayout === "split") {
      table = document.createElement("table");
      table.className = "vc-diff-table vc-diff-split";
      const colgroup = document.createElement("colgroup");
      for (const cls of [
        "vc-col-ln",
        "vc-col-code",
        "vc-col-ln",
        "vc-col-code",
      ]) {
        const col = document.createElement("col");
        col.className = cls;
        colgroup.appendChild(col);
      }
      table.appendChild(colgroup);
      const tbody = document.createElement("tbody");
      const rows = buildSideBySideRows(diff.ops, showFull);
      for (const row of rows) {
        const tr = document.createElement("tr");
        if (row.type === "hunk") {
          tr.className = "vc-row-hunk";
          const td = document.createElement("td");
          td.colSpan = 4;
          td.textContent = `⋯ ${row.skipped} unchanged line${row.skipped === 1 ? "" : "s"} hidden ⋯`;
          tr.appendChild(td);
        } else {
          const tdNumA = document.createElement("td");
          tdNumA.className = `vc-ln vc-cell-${row.left.type}`;
          tdNumA.textContent = row.left.num === "" ? "" : String(row.left.num);

          const tdCodeA = document.createElement("td");
          tdCodeA.className = `vc-code vc-cell-${row.left.type}`;
          tdCodeA.textContent = row.left.text;

          const tdNumB = document.createElement("td");
          tdNumB.className = `vc-ln vc-ln-right vc-cell-${row.right.type}`;
          tdNumB.textContent =
            row.right.num === "" ? "" : String(row.right.num);

          const tdCodeB = document.createElement("td");
          tdCodeB.className = `vc-code vc-cell-${row.right.type}`;
          tdCodeB.textContent = row.right.text;

          tr.append(tdNumA, tdCodeA, tdNumB, tdCodeB);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    } else {
      const items = buildUnifiedDisplayItems(diff.ops, showFull);
      table = createUnifiedDiffTable(items, {
        hunkText: (skipped) =>
          `⋯ ${skipped} unchanged line${skipped === 1 ? "" : "s"} hidden ⋯`,
      });
    }
    diffBodyEl.appendChild(table);
  }

  function update3dOverlayLabels() {
    const isOverlay = threeModeSelect.value === "overlay";
    threeDividerEl.style.display = isOverlay ? "none" : "block";
    threeLabelAEl.style.display = isOverlay ? "none" : "block";
    threeLabelBEl.style.display = isOverlay ? "none" : "block";
    threeLegendEl.style.display = isOverlay ? "flex" : "none";
  }

  function update3dScadSelector() {
    const entA = extractScadEntries(snapshotA?.content || "");
    const entB = extractScadEntries(snapshotB?.content || "");
    const combined = Array.from(
      new Set([...entA.scadFiles, ...entB.scadFiles]),
    );

    if (combined.length > 1) {
      const prev = threeScadSelect.value;
      threeScadSelect.innerHTML = "";
      for (const f of combined) {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        threeScadSelect.appendChild(opt);
      }
      if (prev && combined.includes(prev)) {
        threeScadSelect.value = prev;
      } else if (currentEntryFile && combined.includes(currentEntryFile)) {
        threeScadSelect.value = currentEntryFile;
      }
      threeScadSelect.style.display = "flex";
    } else {
      threeScadSelect.style.display = "none";
      threeScadSelect.innerHTML = "";
    }
  }

  function fitCompareCamera() {
    if (!threeCamera || !threeControls) return;
    const combinedBox = new THREE.Box3();
    if (meshGroupA) {
      meshGroupA.updateMatrixWorld(true);
      const boxA = computeModelBounds(meshGroupA, []);
      if (!boxA.isEmpty()) combinedBox.union(boxA);
    }
    if (meshGroupB) {
      meshGroupB.updateMatrixWorld(true);
      const boxB = computeModelBounds(meshGroupB, []);
      if (!boxB.isEmpty()) combinedBox.union(boxB);
    }
    if (combinedBox.isEmpty()) return;

    const floorY = combinedBox.min.y - 0.01;
    for (const sObj of [threeSceneObjA, threeSceneObjB, threeSceneObjOverlay]) {
      if (!sObj) continue;
      sObj.grid.position.y = floorY;
      sObj.axes.position.y = floorY + 0.002;
    }

    fitCameraToBox(threeCamera, threeControls, null, null, combinedBox);
  }

  function resizeThreeRenderer() {
    if (!threeRenderer || !threeCamera || !threeViewportEl) return;
    const w = threeViewportEl.clientWidth || 1;
    const h = threeViewportEl.clientHeight || 1;
    const isOverlay = threeModeSelect.value === "overlay";
    const renderW = isOverlay ? w : Math.max(1, Math.floor(w / 2));
    threeCamera.aspect = renderW / h;
    threeCamera.updateProjectionMatrix();
    threeRenderer.setSize(w, h);
  }

  function initThreeIfNeeded() {
    if (threeInitialized) return;
    threeInitialized = true;

    const w = threeViewportEl.clientWidth || 600;
    const h = threeViewportEl.clientHeight || 400;

    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    threeRenderer.toneMappingExposure = 1.0;
    threeRenderer.setSize(w, h);
    threeViewportEl.prepend(threeRenderer.domElement);

    threePmrem = new THREE.PMREMGenerator(threeRenderer);
    threeEnvTex = threePmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    threeSceneObjA = createCompareScene(threeEnvTex);
    threeSceneObjB = createCompareScene(threeEnvTex);
    threeSceneObjOverlay = createCompareScene(threeEnvTex);

    threeCamera = new THREE.PerspectiveCamera(60, w / 2 / h, 0.1, 2000);
    threeCamera.position.set(50, 50, -50);

    threeControls = new OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.1;

    resizeObserver = new ResizeObserver(() => resizeThreeRenderer());
    resizeObserver.observe(threeViewportEl);
    resizeThreeRenderer();

    const loop = () => {
      animFrameId = requestAnimationFrame(loop);
      if (activeTab !== "3d" || !threeRenderer) return;
      threeControls.update();

      const vw = threeViewportEl.clientWidth || 1;
      const vh = threeViewportEl.clientHeight || 1;
      if (threeModeSelect.value === "overlay") {
        threeRenderer.setScissorTest(false);
        threeRenderer.setViewport(0, 0, vw, vh);
        threeRenderer.render(threeSceneObjOverlay.scene, threeCamera);
      } else {
        const halfW = Math.floor(vw / 2);
        threeRenderer.setScissorTest(true);

        threeRenderer.setViewport(0, 0, halfW, vh);
        threeRenderer.setScissor(0, 0, halfW, vh);
        threeRenderer.render(threeSceneObjA.scene, threeCamera);

        threeRenderer.setViewport(halfW, 0, vw - halfW, vh);
        threeRenderer.setScissor(halfW, 0, vw - halfW, vh);
        threeRenderer.render(threeSceneObjB.scene, threeCamera);

        threeRenderer.setScissorTest(false);
      }
    };
    loop();
  }

  function clearThreeMeshes() {
    if (meshGroupA && threeSceneObjA) {
      threeSceneObjA.scene.remove(meshGroupA);
      disposeThreeObject(meshGroupA);
      meshGroupA = null;
    }
    if (meshGroupB && threeSceneObjB) {
      threeSceneObjB.scene.remove(meshGroupB);
      disposeThreeObject(meshGroupB);
      meshGroupB = null;
    }
    if (overlayGroupA && threeSceneObjOverlay) {
      threeSceneObjOverlay.scene.remove(overlayGroupA);
      disposeThreeObject(overlayGroupA);
      overlayGroupA = null;
    }
    if (overlayGroupB && threeSceneObjOverlay) {
      threeSceneObjOverlay.scene.remove(overlayGroupB);
      disposeThreeObject(overlayGroupB);
      overlayGroupB = null;
    }
  }

  function applyWireframeState() {
    const isWire = threeWireframeCb.checked;
    if (meshGroupA) setupMeshShadowsAndWireframe(meshGroupA, isWire);
    if (meshGroupB) setupMeshShadowsAndWireframe(meshGroupB, isWire);
    if (overlayGroupA) setupMeshShadowsAndWireframe(overlayGroupA, isWire);
    if (overlayGroupB) setupMeshShadowsAndWireframe(overlayGroupB, isWire);
  }

  async function render3dComparison() {
    initThreeIfNeeded();
    update3dOverlayLabels();
    update3dScadSelector();
    resizeThreeRenderer();

    const token = ++renderToken;
    clearThreeMeshes();

    const targetScad =
      threeScadSelect.style.display !== "none" ? threeScadSelect.value : null;
    const isWire = threeWireframeCb.checked;

    const statusNotes = [];
    let glbA = null;
    let glbB = null;

    try {
      threeStatusEl.textContent = "Compiling Version A...";
      glbA = await compileContentToGlb(
        snapshotA?.content || "",
        targetScad,
        fetchDependencies,
      );
      if (!glbA) statusNotes.push("A: no SCAD geometry");
    } catch (err) {
      statusNotes.push(`A compile failed: ${err?.message || err}`);
    }
    if (token !== renderToken) return;

    try {
      threeStatusEl.textContent = "Compiling Version B...";
      glbB = await compileContentToGlb(
        snapshotB?.content || "",
        targetScad,
        fetchDependencies,
      );
      if (!glbB) statusNotes.push("B: no SCAD geometry");
    } catch (err) {
      statusNotes.push(`B compile failed: ${err?.message || err}`);
    }
    if (token !== renderToken) return;

    try {
      if (glbA) {
        meshGroupA = await parseGlbToGroup(glbA);
        if (token !== renderToken) {
          disposeThreeObject(meshGroupA);
          meshGroupA = null;
          return;
        }
        setupMeshShadowsAndWireframe(meshGroupA, isWire);
        threeSceneObjA.scene.add(meshGroupA);

        overlayGroupA = cloneWithTint(
          meshGroupA,
          0xef4444,
          0.45,
          false,
          isWire,
        );
        threeSceneObjOverlay.scene.add(overlayGroupA);
      }

      if (glbB) {
        meshGroupB = await parseGlbToGroup(glbB);
        if (token !== renderToken) {
          disposeThreeObject(meshGroupB);
          meshGroupB = null;
          return;
        }
        setupMeshShadowsAndWireframe(meshGroupB, isWire);
        threeSceneObjB.scene.add(meshGroupB);

        overlayGroupB = cloneWithTint(meshGroupB, 0x22c55e, 0.55, true, isWire);
        threeSceneObjOverlay.scene.add(overlayGroupB);
      }

      fitCompareCamera();

      if (statusNotes.length > 0) {
        threeStatusEl.textContent = statusNotes.join(" | ");
      } else {
        const sameText =
          (snapshotA?.content || "") === (snapshotB?.content || "");
        threeStatusEl.textContent = sameText
          ? "Ready (identical SCAD source)"
          : "Ready";
      }
    } catch (err) {
      threeStatusEl.textContent = `Render error: ${err?.message || err}`;
    }
  }

  function refreshComparison() {
    snapshotA = resolveSelectedSnapshot("A");
    snapshotB = resolveSelectedSnapshot("B");
    updateMetaDisplay("A", snapshotA);
    updateMetaDisplay("B", snapshotB);
    updateFileFilterOptions();
    renderCodeDiff();

    if (activeTab === "3d") {
      render3dComparison();
    }
  }

  function closeModal() {
    renderToken++;
    document.removeEventListener("keydown", onKeyDown);
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    clearThreeMeshes();
    if (threeControls) {
      threeControls.dispose();
      threeControls = null;
    }
    if (threeEnvTex) {
      threeEnvTex.dispose();
      threeEnvTex = null;
    }
    if (threePmrem) {
      threePmrem.dispose();
      threePmrem = null;
    }
    if (threeRenderer) {
      threeRenderer.dispose();
      threeRenderer = null;
    }
    overlay.remove();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      closeModal();
    }
  }
  document.addEventListener("keydown", onKeyDown);

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  tabCodeBtn.addEventListener("click", () => {
    activeTab = "code";
    tabCodeBtn.classList.add("active");
    tab3dBtn.classList.remove("active");
    codeSection.style.display = "flex";
    threeSection.style.display = "none";
  });

  tab3dBtn.addEventListener("click", () => {
    activeTab = "3d";
    tab3dBtn.classList.add("active");
    tabCodeBtn.classList.remove("active");
    codeSection.style.display = "none";
    threeSection.style.display = "flex";
    render3dComparison();
  });

  modelASelect.addEventListener("change", async () => {
    await refreshSideVersions("A");
    refreshComparison();
  });

  modelBSelect.addEventListener("change", async () => {
    await refreshSideVersions("B");
    refreshComparison();
  });

  versionASelect.addEventListener("change", refreshComparison);
  versionBSelect.addEventListener("change", refreshComparison);

  swapBtn.addEventListener("click", async () => {
    const prevModelA = modelASelect.value;
    const prevVerA = versionASelect.value;
    const prevModelB = modelBSelect.value;
    const prevVerB = versionBSelect.value;

    modelASelect.value = prevModelB;
    modelBSelect.value = prevModelA;
    await refreshSideVersions("A", prevVerB);
    await refreshSideVersions("B", prevVerA);
    refreshComparison();
  });

  fileFilterSelect.addEventListener("change", renderCodeDiff);

  modeSplitBtn.addEventListener("click", () => {
    diffLayout = "split";
    modeSplitBtn.classList.add("active");
    modeUnifiedBtn.classList.remove("active");
    renderCodeDiff();
  });

  modeUnifiedBtn.addEventListener("click", () => {
    diffLayout = "unified";
    modeUnifiedBtn.classList.add("active");
    modeSplitBtn.classList.remove("active");
    renderCodeDiff();
  });

  fullFileCb.addEventListener("change", renderCodeDiff);

  threeModeSelect.addEventListener("change", () => {
    update3dOverlayLabels();
    resizeThreeRenderer();
  });
  threeScadSelect.addEventListener("change", () => {
    if (activeTab === "3d") render3dComparison();
  });
  threeWireframeCb.addEventListener("change", applyWireframeState);
  threeFitBtn.addEventListener("click", fitCompareCamera);

  restoreABtn.addEventListener("click", async () => {
    if (!snapshotA || !onRestore) return;
    const snap = snapshotA;
    closeModal();
    await onRestore(snap);
  });

  restoreBBtn.addEventListener("click", async () => {
    if (!snapshotB || !onRestore) return;
    const snap = snapshotB;
    closeModal();
    await onRestore(snap);
  });

  // Choose natural initial defaults for A and B
  const activeState = await loadModelState(activeModelId);
  const activeVersions = activeState.versions;

  let defaultModelA = activeModelId;
  let defaultVerA = null;
  let defaultModelB = activeModelId;
  let defaultVerB = CURRENT_EDITOR_VALUE;

  if (activeVersions.length > 0) {
    const selVer =
      activeVersions.find((v) => v.id === selectedVersionId) ||
      activeVersions[0];
    if (selVer.content !== currentContent) {
      defaultVerA = selVer.id;
      defaultVerB = CURRENT_EDITOR_VALUE;
    } else if (activeVersions.length >= 2) {
      const selIdx = activeVersions.findIndex((v) => v.id === selVer.id);
      if (selIdx === 0) {
        defaultVerA = activeVersions[1].id;
        defaultVerB = activeVersions[0].id;
      } else {
        defaultVerA = selVer.id;
        defaultVerB = CURRENT_EDITOR_VALUE;
      }
    } else {
      defaultVerA = selVer.id;
      defaultVerB = CURRENT_EDITOR_VALUE;
    }
  } else if (savedModels.length > 0) {
    defaultModelA = savedModels[0].id;
    defaultVerA = null;
    defaultModelB = activeModelId;
    defaultVerB = CURRENT_EDITOR_VALUE;
  }

  populateModelSelect(modelASelect, defaultModelA);
  populateModelSelect(modelBSelect, defaultModelB);
  await refreshSideVersions("A", defaultVerA);
  await refreshSideVersions("B", defaultVerB);
  refreshComparison();
}
