import wasmUrl from "scad-gltf/openscad.wasm?url";
import { convertScadToGltf, convertScadTo3MF } from "scad-gltf/convert";
import * as THREE from "three";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import {
  PROMPT_UI_HTML,
  setupPromptToggles,
  buildPromptFromUI,
  buildRefinementPromptFromUI,
} from "./prompt-ui.js";
import {
  extractFilesFromMarkdown,
  extractModelNameFromScad,
  getMarkdownLangFromPath,
} from "scad-gltf/utils";
import {
  extractRootFolderFromMarkdownFiles,
  isMarkdownContent,
  parseMdFileBlocks,
  findMdBlockAtCursor,
  isScadFilePath,
  analyzeMdLines,
  getSafeFenceForContent,
  normalizeRepoPath,
} from "./md-utils.js";
import { openMdPatchModal } from "./md-patch-modal.js";
import {
  updateCameraAspect,
  computeModelBounds,
  downloadBlob,
  encodeCode,
  decodeCode,
  fetchDependencies,
  getFileParam,
  fetchModelFromUrl,
  fitCameraToBox,
  setupMeshShadowsAndWireframe,
  applyDynamicBoundsToLights,
  extractCamerasAndLights,
} from "./shared.js";
import {
  createViewerContext,
  createAnimationController,
  bindViewerControls,
  disposeThreeObject,
  parseGlbBuffer,
  populateCameraSelect,
} from "./viewer-core.js";
import { startAnimationVideoRecording } from "./video-recorder.js";
import {
  parseGodotMarkdownProject,
  compileGodotProjectToPck,
  exportGodotProjectWebZip,
} from "./godot-project.js";
import { parseMarkdownProject, exportProjectZip } from "./project-zip.js";
import {
  loadActiveWorkspaceSync,
  saveActiveWorkspaceSync,
  loadAutoVersionPref,
  saveAutoVersionPref,
  getLocalModels,
  getLocalModel,
  saveLocalModel,
  deleteLocalModel,
  getModelVersions,
  createVersionSnapshot,
  deleteVersionSnapshot,
  migrateModelVersions,
  upsertOpenedLocalModel,
  formatVersionTimestamp,
  DRAFT_MODEL_ID,
} from "./local-store.js";
import { openVersionCompareModal } from "./version-compare.js";

// --- UI Elements ---
const tabEditorBtn = document.getElementById("tab-editor");
const tabPromptBtn = document.getElementById("tab-prompt");
const editorTabContent = document.getElementById("editor-tab-content");
const promptPanel = document.getElementById("prompt-panel");

const promptDescEl = document.getElementById("prompt-desc");
const copyPromptBtn = document.getElementById("copy-prompt-btn");
const copyRefinementBtn = document.getElementById("copy-refinement-btn");
const modelNameInputEl = document.getElementById("model-name-input");
const entryFileSelect = document.getElementById("entry-file-select");
const copyMdFileBtn = document.getElementById("copy-md-file-btn");
const pasteMdFileBtn = document.getElementById("paste-md-file-btn");
const patchMdBtn = document.getElementById("patch-md-btn");
const mdPatchToastEl = document.getElementById("md-patch-toast");
const mdPatchToastSummaryEl = document.getElementById("md-patch-toast-summary");
const mdPatchToastFilesEl = document.getElementById("md-patch-toast-files");
const mdPatchUndoBtn = document.getElementById("md-patch-undo-btn");
const mdPatchDiffBtn = document.getElementById("md-patch-diff-btn");
const mdPatchCloseBtn = document.getElementById("md-patch-close-btn");
const editorEl = document.getElementById("editor");
const editorContainerEl = document.getElementById("editor-container");
const editorHighlightsEl = document.getElementById("editor-highlights");
const renderBtn = document.getElementById("render-btn");
const loadScadBtn = document.getElementById("load-scad-btn");
const downloadScadBtn = document.getElementById("download-scad-btn");
const downloadMdBtn = document.getElementById("download-md-btn");
const exportGltfBtn = document.getElementById("export-gltf-btn");
const export3mfBtn = document.getElementById("export-3mf-btn");
const captureImageBtn = document.getElementById("capture-image-btn");
const shareBtn = document.getElementById("share-btn");
const autoRenderCb = document.getElementById("auto-render-cb");
const embedShareCb = document.getElementById("embed-share-cb");

const appContainer = document.getElementById("app-container");
const viewerEl = document.getElementById("viewer");
const renderTimeEl = document.getElementById("render-time");

const backendUrlEl = document.getElementById("backend-url");
const backendConnectBtn = document.getElementById("backend-connect-btn");
const backendUiEl = document.getElementById("backend-ui");
const backendSelectEl = document.getElementById("backend-select");
const backendSingleSaveBtn = document.getElementById("backend-single-save-btn");
const backendDeleteBtn = document.getElementById("backend-delete-btn");

const localModelSelectEl = document.getElementById("local-model-select");
const localSaveModelBtn = document.getElementById("local-save-model-btn");
const localNewModelBtn = document.getElementById("local-new-model-btn");
const localDeleteModelBtn = document.getElementById("local-delete-model-btn");
const localVersionNoteEl = document.getElementById("local-version-note");
const localSaveVersionBtn = document.getElementById("local-save-version-btn");
const localVersionSelectEl = document.getElementById("local-version-select");
const localRestoreVersionBtn = document.getElementById(
  "local-restore-version-btn",
);
const localCompareVersionsBtn = document.getElementById(
  "local-compare-versions-btn",
);
const localDeleteVersionBtn = document.getElementById(
  "local-delete-version-btn",
);
const localSaveStatusEl = document.getElementById("local-save-status");
const autoVersionCb = document.getElementById("auto-version-cb");

const animControlsSection = document.getElementById("anim-controls-section");
const animPlayBtn = document.getElementById("anim-play-btn");
const animSelect = document.getElementById("anim-select");
const animSliderRow = document.getElementById("anim-slider-row");
const animSlider = document.getElementById("anim-slider");
const animTimelineLabel = document.getElementById("anim-timeline-label");
const animTimelineCb = document.getElementById("anim-timeline-cb");
const promptUiContainer = document.getElementById("prompt-ui-container");

const showGridCb = document.getElementById("show-grid-cb");
const wireframeCb = document.getElementById("wireframe-cb");
const bloomCb = document.getElementById("bloom-cb");
const lightsCb = document.getElementById("lights-cb");
const expandBtn = document.getElementById("expand-btn");
const exitExpandBtn = document.getElementById("exit-expand-btn");
const screenshotBtn = document.getElementById("screenshot-btn");
const cameraSelect = document.getElementById("camera-select");

const playGodotBtn = document.getElementById("play-godot-btn");
const downloadGodotZipBtn = document.getElementById("download-godot-zip-btn");
const downloadProjectZipBtn = document.getElementById(
  "download-project-zip-btn",
);
const godotPanel = document.getElementById("godot-panel");
const godotViewport = document.getElementById("godot-viewport");
const godotStatusOverlay = document.getElementById("godot-status-overlay");
const godotRestartBtn = document.getElementById("godot-restart-btn");
const godotStopBtn = document.getElementById("godot-stop-btn");
const godotLogsBtn = document.getElementById("godot-logs-btn");
const godotScreenshotBtn = document.getElementById("godot-screenshot-btn");
const godotExpandBtn = document.getElementById("godot-expand-btn");
const godotLogsDrawer = document.getElementById("godot-logs-drawer");
const godotLogsOutput = document.getElementById("godot-logs-output");
const godotLogsCopyBtn = document.getElementById("godot-logs-copy-btn");
const godotLogsClearBtn = document.getElementById("godot-logs-clear-btn");
const runUeBtn = document.getElementById("run-ue-btn");
const uePanel = document.getElementById("ue-panel");
const ueStatusBadge = document.getElementById("ue-status-badge");
const ueRestartBtn = document.getElementById("ue-restart-btn");
const ueStopBtn = document.getElementById("ue-stop-btn");
const ueCloseBtn = document.getElementById("ue-close-btn");
const ueLogsOutput = document.getElementById("ue-logs-output");
const ueLogsCopyBtn = document.getElementById("ue-logs-copy-btn");
const ueLogsClearBtn = document.getElementById("ue-logs-clear-btn");
const viewerControlsEl = document.getElementById("viewer-controls");

let currentSelectedModelIdx = "";
let autoDerivedModelName = null;
let pendingForceNameOverride = false;
let currentEntryFile = null;
let currentEntryScadFile = null;
let currentMesh = null;
let currentGltfData = null;
let currentAnimations = [];
let isCompiling = false;
let pendingCode = null;
let captureNextFrame = false;
let activeVideoRecorder = null;

// Track connection and state
let isServerConnected = false;
let currentModelOriginalState = {
  isNew: true,
  options: {},
  content: "",
};

let gltfCameras = [];
let gltfLights = [];
let activeCamera = null;
let sceneHasLights = false;
let currentOptimalExposure = 1.0;

let isGodotProject = false;
let isGodotPlaying = false;
let godotIframe = null;
let godotRunToken = 0;
const godotScadCache = new Map();

let isUeProject = false;
let isUeRunning = false;
let uePollTimer = null;
let ueLogOffset = 0;

let activeLocalModelId = DRAFT_MODEL_ID;
let localModelsList = [];
let localVersionsList = [];
let localAutoVersionTimer = null;
let lastAutoVersionAt = 0;
let isRestoringWorkspace = false;
let lastPatchUndoState = null;

// Tab logic
if (tabEditorBtn && tabPromptBtn && editorTabContent && promptPanel) {
  tabEditorBtn.addEventListener("click", () => {
    tabEditorBtn.classList.add("active");
    tabPromptBtn.classList.remove("active");
    editorTabContent.style.display = "flex";
    promptPanel.style.display = "none";
  });
  tabPromptBtn.addEventListener("click", () => {
    tabPromptBtn.classList.add("active");
    tabEditorBtn.classList.remove("active");
    promptPanel.style.display = "flex";
    editorTabContent.style.display = "none";
  });
}

// Helper to determine what to render
function getEditorContent() {
  return editorEl.value;
}

function getDownloadName() {
  return modelNameInputEl.value.trim() || "model";
}

function stripModelExtension(name) {
  return String(name || "").replace(/\.(md|scad)$/i, "");
}

function getActiveScadTarget(code) {
  const ctx = getMdFilesContext(code);
  if (!ctx.isMd || ctx.allFiles.length === 0) {
    return null;
  }

  const scadFiles = ctx.allFiles.filter((f) => isScadFilePath(f));
  if (scadFiles.length === 0) {
    return {
      ctx,
      scadFiles,
      targetFile: null,
      scadContent: "",
      baseName: stripModelExtension(getDownloadName()) || "model",
    };
  }

  const targetFile =
    currentEntryFile && scadFiles.includes(currentEntryFile)
      ? currentEntryFile
      : currentEntryScadFile && scadFiles.includes(currentEntryScadFile)
        ? currentEntryScadFile
        : scadFiles[0];

  const scadContent = ctx.filesMap[targetFile] ?? "";
  const baseTargetFile = targetFile.split(/[/\\]/).pop() || "";
  const targetStem = stripModelExtension(baseTargetFile);

  let baseName;
  if (
    scadFiles.length > 1 ||
    (baseTargetFile && baseTargetFile.toLowerCase() !== "main.scad")
  ) {
    baseName = targetStem || "model";
  } else {
    baseName = stripModelExtension(getDownloadName()) || "model";
  }

  return {
    ctx,
    scadFiles,
    targetFile,
    scadContent,
    baseName,
  };
}

function getScadExportBaseName(code) {
  const active = getActiveScadTarget(code);
  if (active) {
    return active.baseName;
  }
  return stripModelExtension(getDownloadName()) || "model";
}

function updateLocalSaveStatus(message, isSaved = true) {
  if (!localSaveStatusEl) return;
  localSaveStatusEl.textContent = message;
  localSaveStatusEl.classList.toggle("saved", Boolean(isSaved));
}

function saveWorkspaceImmediate() {
  if (isRestoringWorkspace) return;
  const ok = saveActiveWorkspaceSync({
    activeModelId: activeLocalModelId,
    name: modelNameInputEl.value,
    content: editorEl.value,
    entryFile: currentEntryFile,
  });
  if (ok) {
    updateLocalSaveStatus(
      `Saved locally • ${formatVersionTimestamp(Date.now())}`,
      true,
    );
  }
}

async function syncNamedLocalModelContent() {
  if (activeLocalModelId === DRAFT_MODEL_ID) return;
  const existing = await getLocalModel(activeLocalModelId);
  if (!existing) return;
  await saveLocalModel({
    id: activeLocalModelId,
    name: modelNameInputEl.value.trim() || existing.name,
    content: editorEl.value,
    entryFile: currentEntryFile,
  });
}

async function refreshLocalModelsUi() {
  localModelsList = await getLocalModels();
  if (
    activeLocalModelId !== DRAFT_MODEL_ID &&
    !localModelsList.some((m) => m.id === activeLocalModelId)
  ) {
    activeLocalModelId = DRAFT_MODEL_ID;
  }
  if (!localModelSelectEl) return;
  localModelSelectEl.innerHTML =
    '<option value="__draft__">-- Active Draft --</option>';
  for (const m of localModelsList) {
    if (m.id === DRAFT_MODEL_ID) continue;
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name || "Untitled";
    localModelSelectEl.appendChild(opt);
  }
  localModelSelectEl.value = activeLocalModelId;
  if (localDeleteModelBtn) {
    localDeleteModelBtn.style.display =
      activeLocalModelId === DRAFT_MODEL_ID ? "none" : "flex";
  }
  if (localCompareVersionsBtn) {
    localCompareVersionsBtn.disabled =
      localVersionsList.length === 0 && localModelsList.length === 0;
  }
}

async function refreshVersionsUi(preferredVersionId = null) {
  localVersionsList = await getModelVersions(activeLocalModelId);
  if (!localVersionSelectEl) return;

  localVersionSelectEl.innerHTML = "";
  if (localVersionsList.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "-- No saved versions --";
    localVersionSelectEl.appendChild(opt);
    if (localRestoreVersionBtn) localRestoreVersionBtn.disabled = true;
    if (localDeleteVersionBtn) localDeleteVersionBtn.disabled = true;
    if (localCompareVersionsBtn) {
      localCompareVersionsBtn.disabled = localModelsList.length === 0;
    }
    return;
  }

  for (const v of localVersionsList) {
    const opt = document.createElement("option");
    opt.value = v.id;
    const kindTag = v.kind === "manual" ? "Manual" : "Auto";
    const notePart = v.label ? ` "${v.label}"` : "";
    const timeStr = formatVersionTimestamp(v.createdAt);
    opt.textContent = `v${v.versionNumber} [${kindTag}]${notePart} • ${timeStr} (${v.lineCount}L)`;
    localVersionSelectEl.appendChild(opt);
  }

  if (
    preferredVersionId &&
    localVersionsList.some((v) => v.id === preferredVersionId)
  ) {
    localVersionSelectEl.value = preferredVersionId;
  } else {
    localVersionSelectEl.value = localVersionsList[0].id;
  }

  if (localRestoreVersionBtn) localRestoreVersionBtn.disabled = false;
  if (localDeleteVersionBtn) localDeleteVersionBtn.disabled = false;
  if (localCompareVersionsBtn) localCompareVersionsBtn.disabled = false;
}

async function maybeCreateAutoVersion(label = "", force = false) {
  if (isRestoringWorkspace) return null;
  if (!force && autoVersionCb && !autoVersionCb.checked) return null;

  const content = editorEl.value;
  if (!content.trim()) return null;

  const now = Date.now();
  if (!force && now - lastAutoVersionAt < 5000) {
    return null;
  }

  const res = await createVersionSnapshot({
    modelId: activeLocalModelId,
    content,
    name: modelNameInputEl.value,
    entryFile: currentEntryFile,
    kind: "auto",
    label,
  });
  await syncNamedLocalModelContent();
  if (res.created) {
    lastAutoVersionAt = now;
    await refreshVersionsUi();
  }
  return res;
}

function scheduleAutoVersion() {
  clearTimeout(localAutoVersionTimer);
  if (autoVersionCb && !autoVersionCb.checked) return;
  localAutoVersionTimer = setTimeout(() => {
    maybeCreateAutoVersion("Auto");
  }, 10000);
}

async function initLocalPersistence() {
  if (autoVersionCb) {
    autoVersionCb.checked = loadAutoVersionPref();
    autoVersionCb.addEventListener("change", () => {
      saveAutoVersionPref(autoVersionCb.checked);
    });
  }

  const saved = loadActiveWorkspaceSync();
  if (saved) {
    isRestoringWorkspace = true;
    try {
      activeLocalModelId = saved.activeModelId || DRAFT_MODEL_ID;
      if (saved.name) modelNameInputEl.value = saved.name;
      if (saved.content) editorEl.value = saved.content;
      if (saved.entryFile) currentEntryFile = saved.entryFile;
    } finally {
      isRestoringWorkspace = false;
    }
    if (saved.content || saved.name) {
      updateLocalSaveStatus(
        `Restored • ${formatVersionTimestamp(saved.updatedAt)}`,
        true,
      );
    }
  }

  await refreshLocalModelsUi();
  await refreshVersionsUi();
}

async function persistCurrentActiveModel(snapshotLabel = "Before switch") {
  if (isRestoringWorkspace) return;
  if (editorEl.value.trim()) {
    await maybeCreateAutoVersion(snapshotLabel, true);
  }
  if (activeLocalModelId === DRAFT_MODEL_ID) {
    await saveLocalModel({
      id: DRAFT_MODEL_ID,
      name: modelNameInputEl.value,
      content: editorEl.value,
      entryFile: currentEntryFile,
    });
  } else {
    await syncNamedLocalModelContent();
  }
}

async function openModelInLocalStore({
  content = "",
  name = null,
  entryFile = null,
  fallbackPrefix = "Shared Model",
  versionLabel = "Opened",
} = {}) {
  const normalizedContent = String(content ?? "");
  if (editorEl.value !== normalizedContent && editorEl.value.trim()) {
    await persistCurrentActiveModel(`Before ${versionLabel}`);
  } else if (activeLocalModelId === DRAFT_MODEL_ID) {
    await saveLocalModel({
      id: DRAFT_MODEL_ID,
      name: modelNameInputEl.value,
      content: editorEl.value,
      entryFile: currentEntryFile,
    });
  } else {
    await syncNamedLocalModelContent();
  }

  const result = await upsertOpenedLocalModel({
    content: normalizedContent,
    name,
    entryFile,
    fallbackPrefix,
    versionLabel,
  });

  lastPatchUndoState = null;
  if (mdPatchToastEl) mdPatchToastEl.style.display = "none";
  isRestoringWorkspace = true;
  try {
    activeLocalModelId = result.model.id;
    autoDerivedModelName = null;
    pendingForceNameOverride = false;
    editorEl.value = result.model.content;
    modelNameInputEl.value = result.model.name;
    currentEntryFile = result.model.entryFile || null;
    currentEntryScadFile = null;
  } finally {
    isRestoringWorkspace = false;
  }

  syncMdFilesUi(editorEl.value);
  if (currentEntryFile !== (result.model.entryFile || null)) {
    await saveLocalModel({
      id: result.model.id,
      name: result.model.name,
      content: result.model.content,
      entryFile: currentEntryFile,
    });
  }

  saveWorkspaceImmediate();
  await refreshLocalModelsUi();
  await refreshVersionsUi(result.version?.id || null);
  updateLocalSaveStatus(
    result.isNew
      ? `Saved to new local model • ${formatVersionTimestamp(Date.now())}`
      : `Loaded local model • ${formatVersionTimestamp(Date.now())}`,
    true,
  );
  return result;
}

if (localModelSelectEl) {
  localModelSelectEl.addEventListener("change", async () => {
    const nextId = localModelSelectEl.value || DRAFT_MODEL_ID;
    if (nextId === activeLocalModelId) return;

    await maybeCreateAutoVersion("Before switch", true);
    if (activeLocalModelId === DRAFT_MODEL_ID) {
      await saveLocalModel({
        id: DRAFT_MODEL_ID,
        name: modelNameInputEl.value,
        content: editorEl.value,
        entryFile: currentEntryFile,
      });
    } else {
      await syncNamedLocalModelContent();
    }

    const target = await getLocalModel(nextId);
    lastPatchUndoState = null;
    if (mdPatchToastEl) mdPatchToastEl.style.display = "none";
    isRestoringWorkspace = true;
    try {
      activeLocalModelId = nextId;
      autoDerivedModelName = null;
      pendingForceNameOverride = false;
      editorEl.value = target?.content || "";
      modelNameInputEl.value = target?.name || "";
      currentEntryFile = target?.entryFile || null;
      currentEntryScadFile = null;
    } finally {
      isRestoringWorkspace = false;
    }

    syncMdFilesUi(editorEl.value);
    checkChanges();
    saveWorkspaceImmediate();
    await refreshLocalModelsUi();
    await refreshVersionsUi();
    if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
    compileAndRender(getEditorContent());
  });
}

if (localSaveModelBtn) {
  localSaveModelBtn.addEventListener("click", async () => {
    let modelName = modelNameInputEl.value.trim();
    if (!modelName) {
      const entered = prompt("Enter a name for this local model:", "my_model");
      if (!entered || !entered.trim()) return;
      modelName = entered.trim();
      modelNameInputEl.value = modelName;
    }

    let targetId = activeLocalModelId;
    if (targetId === DRAFT_MODEL_ID) {
      const existingByName = localModelsList.find(
        (m) => m.name.toLowerCase() === modelName.toLowerCase(),
      );
      if (existingByName) {
        if (
          !confirm(
            `A local model named "${existingByName.name}" already exists. Overwrite it?`,
          )
        ) {
          return;
        }
        targetId = existingByName.id;
      } else {
        targetId = undefined;
      }
    }

    const saved = await saveLocalModel({
      id: targetId,
      name: modelName,
      content: editorEl.value,
      entryFile: currentEntryFile,
    });

    if (activeLocalModelId === DRAFT_MODEL_ID) {
      await migrateModelVersions(DRAFT_MODEL_ID, saved.id);
      await saveLocalModel({
        id: DRAFT_MODEL_ID,
        name: "",
        content: "",
        entryFile: null,
      });
    }

    activeLocalModelId = saved.id;
    const note = localVersionNoteEl ? localVersionNoteEl.value.trim() : "";
    const ver = await createVersionSnapshot({
      modelId: activeLocalModelId,
      content: editorEl.value,
      name: modelName,
      entryFile: currentEntryFile,
      kind: "manual",
      label: note || "Saved local model",
    });
    if (localVersionNoteEl) localVersionNoteEl.value = "";

    saveWorkspaceImmediate();
    await refreshLocalModelsUi();
    await refreshVersionsUi(ver.version?.id);
  });
}

if (localNewModelBtn) {
  localNewModelBtn.addEventListener("click", async () => {
    await maybeCreateAutoVersion("Before new draft", true);
    if (activeLocalModelId !== DRAFT_MODEL_ID) {
      await syncNamedLocalModelContent();
    }

    isRestoringWorkspace = true;
    try {
      activeLocalModelId = DRAFT_MODEL_ID;
      autoDerivedModelName = null;
      pendingForceNameOverride = false;
      editorEl.value = "";
      modelNameInputEl.value = "";
      currentEntryFile = null;
      currentEntryScadFile = null;
    } finally {
      isRestoringWorkspace = false;
    }

    await saveLocalModel({
      id: DRAFT_MODEL_ID,
      name: "",
      content: "",
      entryFile: null,
    });
    syncMdFilesUi("");
    checkChanges();
    saveWorkspaceImmediate();
    await refreshLocalModelsUi();
    await refreshVersionsUi();
    if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
    compileAndRender("");
  });
}

if (localDeleteModelBtn) {
  localDeleteModelBtn.addEventListener("click", async () => {
    if (activeLocalModelId === DRAFT_MODEL_ID) return;
    const current = localModelsList.find((m) => m.id === activeLocalModelId);
    const label = current?.name || "this local model";
    if (
      !confirm(
        `Delete local model "${label}" and all of its saved version history?`,
      )
    ) {
      return;
    }

    await deleteLocalModel(activeLocalModelId);
    const draft = await getLocalModel(DRAFT_MODEL_ID);

    isRestoringWorkspace = true;
    try {
      activeLocalModelId = DRAFT_MODEL_ID;
      autoDerivedModelName = null;
      pendingForceNameOverride = false;
      editorEl.value = draft?.content || "";
      modelNameInputEl.value = draft?.name || "";
      currentEntryFile = draft?.entryFile || null;
      currentEntryScadFile = null;
    } finally {
      isRestoringWorkspace = false;
    }

    syncMdFilesUi(editorEl.value);
    checkChanges();
    saveWorkspaceImmediate();
    await refreshLocalModelsUi();
    await refreshVersionsUi();
    if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
    compileAndRender(getEditorContent());
  });
}

if (localSaveVersionBtn) {
  localSaveVersionBtn.addEventListener("click", async () => {
    const note = localVersionNoteEl ? localVersionNoteEl.value.trim() : "";
    const res = await createVersionSnapshot({
      modelId: activeLocalModelId,
      content: editorEl.value,
      name: modelNameInputEl.value,
      entryFile: currentEntryFile,
      kind: "manual",
      label: note,
    });
    await syncNamedLocalModelContent();
    saveWorkspaceImmediate();
    if (localVersionNoteEl) localVersionNoteEl.value = "";
    await refreshVersionsUi(res.version?.id);

    const origText = localSaveVersionBtn.innerText;
    localSaveVersionBtn.innerText = res.created ? "✅ Saved" : "✓ Unchanged";
    setTimeout(() => {
      localSaveVersionBtn.innerText = origText;
    }, 1500);
  });
}

if (localRestoreVersionBtn) {
  localRestoreVersionBtn.addEventListener("click", async () => {
    const versionId = localVersionSelectEl ? localVersionSelectEl.value : "";
    const target = localVersionsList.find((v) => v.id === versionId);
    if (!target) return;

    if (
      editorEl.value !== target.content ||
      modelNameInputEl.value !== (target.name || "")
    ) {
      await maybeCreateAutoVersion("Before restore", true);
    }

    isRestoringWorkspace = true;
    try {
      editorEl.value = target.content;
      if (target.name !== undefined) {
        modelNameInputEl.value = target.name;
      }
      currentEntryFile = target.entryFile || null;
      currentEntryScadFile = null;
    } finally {
      isRestoringWorkspace = false;
    }

    await syncNamedLocalModelContent();
    syncMdFilesUi(editorEl.value);
    checkChanges();
    saveWorkspaceImmediate();
    await refreshVersionsUi(target.id);
    if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
    compileAndRender(getEditorContent());
  });
}

if (localCompareVersionsBtn) {
  localCompareVersionsBtn.addEventListener("click", () => {
    openVersionCompareModal({
      activeModelId: activeLocalModelId,
      selectedVersionId: localVersionSelectEl ? localVersionSelectEl.value : "",
      currentName: modelNameInputEl.value,
      currentContent: editorEl.value,
      currentEntryFile,
      fetchDependencies: fetchDependenciesWrapper,
      onRestore: async (snapshot) => {
        if (!snapshot) return;
        if (
          editorEl.value !== snapshot.content ||
          modelNameInputEl.value !== (snapshot.name || "")
        ) {
          await maybeCreateAutoVersion("Before restore", true);
        }

        isRestoringWorkspace = true;
        try {
          editorEl.value = snapshot.content;
          if (snapshot.name !== undefined) {
            modelNameInputEl.value = snapshot.name;
          }
          currentEntryFile = snapshot.entryFile || null;
          currentEntryScadFile = null;
        } finally {
          isRestoringWorkspace = false;
        }

        await syncNamedLocalModelContent();
        syncMdFilesUi(editorEl.value);
        checkChanges();
        saveWorkspaceImmediate();
        await refreshVersionsUi();
        if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
        compileAndRender(getEditorContent());
      },
    });
  });
}

if (localDeleteVersionBtn) {
  localDeleteVersionBtn.addEventListener("click", async () => {
    const versionId = localVersionSelectEl ? localVersionSelectEl.value : "";
    if (!versionId) return;
    await deleteVersionSnapshot(versionId);
    await refreshVersionsUi();
  });
}

window.addEventListener("beforeunload", saveWorkspaceImmediate);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveWorkspaceImmediate();
  }
});

function applyDerivedModelName(derivedName, forceOverride = false) {
  const currentVal = modelNameInputEl.value;
  const isUnsetOrAuto =
    !currentVal.trim() ||
    currentVal === autoDerivedModelName ||
    (forceOverride && Boolean(derivedName));

  if (derivedName) {
    if (isUnsetOrAuto && currentVal !== derivedName) {
      modelNameInputEl.value = derivedName;
      autoDerivedModelName = derivedName;
      checkChanges();
      saveWorkspaceImmediate();
    } else if (currentVal === autoDerivedModelName) {
      autoDerivedModelName = derivedName;
    }
  } else if (currentVal === autoDerivedModelName) {
    modelNameInputEl.value = "";
    autoDerivedModelName = null;
    checkChanges();
    saveWorkspaceImmediate();
  }
}

modelNameInputEl.addEventListener("input", () => {
  if (!modelNameInputEl.value.trim()) {
    autoDerivedModelName = null;
  }
  checkChanges();
  saveWorkspaceImmediate();
});

editorEl.addEventListener("paste", () => {
  if (
    backendSelectEl.value === "" &&
    editorEl.selectionStart === 0 &&
    editorEl.selectionEnd === editorEl.value.length
  ) {
    pendingForceNameOverride = true;
  }
});
let lastHighlightedText = null;
let lastHighlightedActiveFile = null;

function syncEditorBackdropScroll() {
  if (!editorEl || !editorHighlightsEl) return;
  editorHighlightsEl.style.transform = `translate3d(${-editorEl.scrollLeft}px, ${-editorEl.scrollTop}px, 0)`;
}

function updateEditorHighlights() {
  if (!editorEl || !editorContainerEl || !editorHighlightsEl) return;

  const text = editorEl.value;
  const activeFile = currentEntryFile || null;

  if (
    text === lastHighlightedText &&
    activeFile === lastHighlightedActiveFile
  ) {
    return;
  }

  if (!text || !isMarkdownContent(text)) {
    if (editorContainerEl.classList.contains("md-highlighted")) {
      editorContainerEl.classList.remove("md-highlighted");
      editorHighlightsEl.replaceChildren();
    }
    lastHighlightedText = text;
    lastHighlightedActiveFile = activeFile;
    return;
  }

  if (
    text === lastHighlightedText &&
    activeFile !== lastHighlightedActiveFile
  ) {
    for (const node of editorHighlightsEl.children) {
      const nodeFile = node.dataset.file;
      if (nodeFile) {
        node.classList.toggle("md-active", nodeFile === activeFile);
      }
    }
    lastHighlightedActiveFile = activeFile;
    return;
  }

  const { parsed, hasFileBlocks } = analyzeMdLines(text);
  if (!hasFileBlocks) {
    editorContainerEl.classList.remove("md-highlighted");
    editorHighlightsEl.replaceChildren();
    lastHighlightedText = text;
    lastHighlightedActiveFile = activeFile;
    return;
  }

  const frag = document.createDocumentFragment();
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const div = document.createElement("div");
    let className = `md-line md-${item.role}`;
    if (item.isScad) {
      className += " md-scad";
    }
    if (item.blockIdx >= 0) {
      className += item.blockIdx % 2 === 0 ? " md-block-even" : " md-block-odd";
    }
    if (item.filePath) {
      div.dataset.file = item.filePath;
      if (item.filePath === activeFile) {
        className += " md-active";
      }
    }
    div.className = className;
    div.textContent = item.line;
    frag.appendChild(div);
  }

  editorHighlightsEl.replaceChildren(frag);
  editorContainerEl.classList.add("md-highlighted");
  lastHighlightedText = text;
  lastHighlightedActiveFile = activeFile;
  syncEditorBackdropScroll();
}

function scrollEditorToMdFile(filePath) {
  const content = editorEl.value;
  const blocks = parseMdFileBlocks(content);
  const normTarget = normalizeRepoPath(filePath);
  const block = blocks.find(
    (b) => normalizeRepoPath(b.filePath) === normTarget,
  );
  if (!block) return;

  editorEl.focus();
  editorEl.setSelectionRange(block.headerStart, block.headerStart);

  const textBefore = content.substring(0, block.headerStart);
  const linesBefore = textBefore.split("\n").length;
  const totalLines = content.split("\n").length || 1;
  const targetLine = Math.max(0, linesBefore - 2);
  editorEl.scrollTop = (targetLine / totalLines) * editorEl.scrollHeight;
  syncEditorBackdropScroll();
}

function getMdFilesContext(code) {
  const godotProject = parseGodotMarkdownProject(code);
  if (godotProject) {
    const filesMap = {};
    for (const [relPath, content] of Object.entries(godotProject.files)) {
      filesMap[`${godotProject.rootPrefix}${relPath}`] = content;
    }
    const allFiles = Object.keys(filesMap);
    return {
      isMd: true,
      isGodot: true,
      allFiles,
      filesMap,
      godotProject,
    };
  }

  if (isMarkdownContent(code)) {
    const filesMap = extractFilesFromMarkdown(code);
    const allFiles = Object.keys(filesMap);
    if (allFiles.length > 0) {
      return {
        isMd: true,
        isGodot: false,
        allFiles,
        filesMap,
        godotProject: null,
      };
    }
  }

  return {
    isMd: false,
    isGodot: false,
    allFiles: [],
    filesMap: {},
    godotProject: null,
  };
}

const ALL_MD_FILE_OPTION = "__all__";

function updateEntryFileSelectStyle(filePath) {
  if (!entryFileSelect) return;
  entryFileSelect.classList.toggle("is-scad-file", isScadFilePath(filePath));
}

function updateMdButtonsTitles(hasMd, targetFile) {
  if (hasMd) {
    if (copyMdFileBtn) {
      copyMdFileBtn.title =
        targetFile === ALL_MD_FILE_OPTION
          ? "Copy full markdown document to clipboard"
          : "Copy selected file content to clipboard";
    }
  } else {
    if (copyMdFileBtn) {
      copyMdFileBtn.title = "Copy editor content to clipboard";
    }
    if (pasteMdFileBtn) {
      pasteMdFileBtn.title = "Replace editor content from clipboard";
    }
  }
}

function syncMdFilesUi(code) {
  const ctx = getMdFilesContext(code);
  if (ctx.isMd && ctx.allFiles.length > 0) {
    const allFiles = ctx.allFiles;
    const scadFiles = allFiles.filter((f) => isScadFilePath(f));
    const otherFiles = allFiles.filter((f) => !isScadFilePath(f));

    entryFileSelect.style.display = "flex";
    if (copyMdFileBtn) copyMdFileBtn.style.display = "flex";
    if (pasteMdFileBtn) pasteMdFileBtn.style.display = "none";
    if (patchMdBtn) patchMdBtn.style.display = "flex";

    const orderedFiles = [ALL_MD_FILE_OPTION, ...scadFiles, ...otherFiles];
    const currentOptions = Array.from(entryFileSelect.options)
      .map((o) => o.value)
      .join(",");
    const newOptions = orderedFiles.join(",");
    if (currentOptions !== newOptions) {
      entryFileSelect.innerHTML = "";

      const allOpt = document.createElement("option");
      allOpt.value = ALL_MD_FILE_OPTION;
      allOpt.className = "file-opt-all";
      allOpt.innerText = "📑 All (.md)";
      entryFileSelect.appendChild(allOpt);

      const createFileOption = (f, isScad) => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.className = isScad ? "file-opt-scad" : "file-opt-other";
        opt.innerText = isScad ? `🧊 ${f}` : `📄 ${f}`;
        return opt;
      };

      if (scadFiles.length > 0 && otherFiles.length > 0) {
        const scadGroup = document.createElement("optgroup");
        scadGroup.label = `SCAD Models (${scadFiles.length})`;
        scadFiles.forEach((f) =>
          scadGroup.appendChild(createFileOption(f, true)),
        );
        entryFileSelect.appendChild(scadGroup);

        const otherGroup = document.createElement("optgroup");
        otherGroup.label = `Other Files (${otherFiles.length})`;
        otherFiles.forEach((f) =>
          otherGroup.appendChild(createFileOption(f, false)),
        );
        entryFileSelect.appendChild(otherGroup);
      } else {
        scadFiles.forEach((f) =>
          entryFileSelect.appendChild(createFileOption(f, true)),
        );
        otherFiles.forEach((f) =>
          entryFileSelect.appendChild(createFileOption(f, false)),
        );
      }
    }

    if (
      currentEntryFile !== ALL_MD_FILE_OPTION &&
      !allFiles.includes(currentEntryFile)
    ) {
      currentEntryFile = scadFiles[0] || allFiles[0];
    }
    if (!scadFiles.includes(currentEntryScadFile)) {
      currentEntryScadFile = scadFiles.includes(currentEntryFile)
        ? currentEntryFile
        : scadFiles[0] || null;
    }
    entryFileSelect.value = currentEntryFile;
    updateEntryFileSelectStyle(currentEntryFile);
    updateMdButtonsTitles(true, currentEntryFile);
  } else {
    entryFileSelect.style.display = "none";
    updateEntryFileSelectStyle(null);
    if (copyMdFileBtn) copyMdFileBtn.style.display = "flex";
    if (pasteMdFileBtn) pasteMdFileBtn.style.display = "flex";
    if (patchMdBtn) patchMdBtn.style.display = "none";
    updateMdButtonsTitles(false, null);
    currentEntryFile = null;
    currentEntryScadFile = null;
  }
  const hasMd = ctx.isMd && ctx.allFiles.length > 0;
  const hasMdScad = hasMd && ctx.allFiles.some((f) => isScadFilePath(f));
  if (downloadMdBtn) {
    downloadMdBtn.style.display = hasMd ? "flex" : "none";
  }
  if (copyRefinementBtn) {
    copyRefinementBtn.style.display = hasMd ? "flex" : "none";
  }
  if (downloadScadBtn) {
    downloadScadBtn.style.display = !hasMd || hasMdScad ? "flex" : "none";
    downloadScadBtn.title = hasMd
      ? "Download active .scad file"
      : "Download .scad file";
  }
  const parsedProject = parseMarkdownProject(code);
  isUeProject = parsedProject?.projectType === "ue";
  if (playGodotBtn) {
    playGodotBtn.style.display = ctx.isGodot ? "flex" : "none";
  }
  if (downloadGodotZipBtn) {
    downloadGodotZipBtn.style.display = ctx.isGodot ? "flex" : "none";
  }
  if (runUeBtn) {
    runUeBtn.style.display = isUeProject ? "flex" : "none";
  }
  if (downloadProjectZipBtn) {
    downloadProjectZipBtn.style.display = parsedProject ? "flex" : "none";
    downloadProjectZipBtn.classList.toggle("godot-btn", ctx.isGodot);
  }
  updateEditorHighlights();
  return ctx;
}

function handleEditorCursorChange() {
  const ctx = getMdFilesContext(editorEl.value);
  if (!ctx.isMd || ctx.allFiles.length === 0) return;

  const block = findMdBlockAtCursor(editorEl.value, editorEl.selectionStart);
  if (!block) return;

  const hasOption = Array.from(entryFileSelect.options).some(
    (o) => o.value === block.filePath,
  );
  if (!hasOption) return;

  if (currentEntryFile !== block.filePath) {
    currentEntryFile = block.filePath;
    entryFileSelect.value = block.filePath;
    updateEntryFileSelectStyle(block.filePath);
    updateMdButtonsTitles(true, block.filePath);
    updateEditorHighlights();
  }

  if (
    isScadFilePath(block.filePath) &&
    block.filePath !== currentEntryScadFile
  ) {
    currentEntryScadFile = block.filePath;
    if (!isGodotPlaying) {
      compileAndRender(getEditorContent());
    }
  }
}

entryFileSelect.addEventListener("change", (e) => {
  const selectedFile = e.target.value;
  currentEntryFile = selectedFile;
  updateEntryFileSelectStyle(selectedFile);
  updateMdButtonsTitles(true, selectedFile);
  if (selectedFile !== ALL_MD_FILE_OPTION) {
    scrollEditorToMdFile(selectedFile);
  }
  updateEditorHighlights();
  saveWorkspaceImmediate();

  if (isScadFilePath(selectedFile)) {
    currentEntryScadFile = selectedFile;
    if (!isGodotPlaying) {
      compileAndRender(getEditorContent());
    }
  }
});

editorEl.addEventListener("scroll", syncEditorBackdropScroll);
editorEl.addEventListener("mouseup", handleEditorCursorChange);
editorEl.addEventListener("keyup", handleEditorCursorChange);

let copyMdFileTimer = null;
if (copyMdFileBtn) {
  copyMdFileBtn.addEventListener("click", async () => {
    const ctx = getMdFilesContext(editorEl.value);
    const isMdWithFiles = ctx.isMd && ctx.allFiles.length > 0;
    const targetFile = isMdWithFiles
      ? entryFileSelect.value || currentEntryFile
      : null;

    let contentToCopy;
    if (!isMdWithFiles || targetFile === ALL_MD_FILE_OPTION) {
      contentToCopy = editorEl.value;
    } else {
      if (!targetFile) return;
      contentToCopy = ctx.filesMap[targetFile];
      if (contentToCopy === undefined) return;
    }

    try {
      await navigator.clipboard.writeText(contentToCopy);
      if (!copyMdFileBtn.dataset.originalText) {
        copyMdFileBtn.dataset.originalText = copyMdFileBtn.innerText;
      }
      copyMdFileBtn.innerText = "✅ Copied!";
      clearTimeout(copyMdFileTimer);
      copyMdFileTimer = setTimeout(() => {
        copyMdFileBtn.innerText =
          copyMdFileBtn.dataset.originalText || "📋 Copy";
      }, 1500);
    } catch (err) {
      alert("Failed to copy to clipboard: " + err);
    }
  });
}

function hideMdPatchToast() {
  if (mdPatchToastEl) mdPatchToastEl.style.display = "none";
}

function showMdPatchToast(
  summaryText,
  appliedItems = [],
  { isInfo = false } = {},
) {
  if (!mdPatchToastEl || !mdPatchToastSummaryEl || !mdPatchToastFilesEl) return;
  mdPatchToastEl.classList.toggle("is-info", Boolean(isInfo));
  mdPatchToastSummaryEl.textContent = summaryText;
  mdPatchToastFilesEl.replaceChildren();

  for (const item of appliedItems) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `md-patch-pill md-patch-pill-${item.action}`;
    const prefix =
      item.action === "add" ? "+ " : item.action === "delete" ? "- " : "~ ";
    pill.textContent = `${prefix}${item.targetPath}`;
    if (item.remappedFrom && item.remappedFrom !== item.targetPath) {
      pill.title = `Mapped from ${item.remappedFrom} (click to jump)`;
    } else if (item.action !== "delete") {
      pill.title = "Click to jump to file";
    }
    if (item.action === "delete") {
      pill.disabled = true;
    } else {
      pill.addEventListener("click", () => {
        const hasOpt = Array.from(entryFileSelect.options).some(
          (o) => o.value === item.targetPath,
        );
        if (hasOpt) {
          currentEntryFile = item.targetPath;
          entryFileSelect.value = item.targetPath;
          updateEntryFileSelectStyle(item.targetPath);
          updateMdButtonsTitles(true, item.targetPath);
        }
        scrollEditorToMdFile(item.targetPath);
        updateEditorHighlights();
        if (isScadFilePath(item.targetPath)) {
          currentEntryScadFile = item.targetPath;
          if (!isGodotPlaying) compileAndRender(getEditorContent());
        }
      });
    }
    mdPatchToastFilesEl.appendChild(pill);
  }

  if (mdPatchUndoBtn) {
    mdPatchUndoBtn.style.display = lastPatchUndoState ? "flex" : "none";
  }
  if (mdPatchDiffBtn) {
    mdPatchDiffBtn.style.display = lastPatchUndoState?.preVersionId
      ? "flex"
      : "none";
  }
  mdPatchToastEl.style.display = "flex";
}

const mdActionButtonTimers = new WeakMap();
function flashMdActionButton(btn, label) {
  if (!btn) return;
  if (!btn.dataset.originalText) {
    btn.dataset.originalText = btn.innerText;
  }
  btn.innerText = label;
  const prevTimer = mdActionButtonTimers.get(btn);
  if (prevTimer) clearTimeout(prevTimer);
  const timer = setTimeout(() => {
    btn.innerText = btn.dataset.originalText;
    mdActionButtonTimers.delete(btn);
  }, 1500);
  mdActionButtonTimers.set(btn, timer);
}

async function applyMdEditWithHistory({
  nextContent,
  appliedItems = [],
  snapshotLabel = "Before paste",
  preserveName = true,
  fullReplace = false,
} = {}) {
  const prevState = {
    content: editorEl.value,
    name: modelNameInputEl.value,
    entryFile: currentEntryFile,
    entryScadFile: currentEntryScadFile,
  };

  const snapRes = await maybeCreateAutoVersion(snapshotLabel, true);
  lastPatchUndoState = {
    ...prevState,
    preVersionId: snapRes?.version?.id || null,
  };

  if (!preserveName && backendSelectEl.value === "") {
    pendingForceNameOverride = true;
  }

  editorEl.value = nextContent;
  syncMdFilesUi(nextContent);
  checkChanges();
  saveWorkspaceImmediate();

  if (fullReplace || appliedItems.length === 0) {
    editorEl.setSelectionRange(0, 0);
    editorEl.scrollTop = 0;
    syncEditorBackdropScroll();
    if (autoRenderCb.checked && !isGodotPlaying) {
      compileAndRender(getEditorContent());
    }
    if (fullReplace) {
      showMdPatchToast("Replaced document", []);
    }
    return;
  }

  const preferredFocus =
    appliedItems.find(
      (i) => i.action !== "delete" && i.targetPath === currentEntryFile,
    ) || appliedItems.find((i) => i.action !== "delete");

  if (preferredFocus) {
    const normPreferred = normalizeRepoPath(preferredFocus.targetPath);
    const updatedBlock = parseMdFileBlocks(nextContent).find(
      (b) => normalizeRepoPath(b.filePath) === normPreferred,
    );
    if (updatedBlock) {
      editorEl.setSelectionRange(
        updatedBlock.contentStart,
        updatedBlock.contentStart,
      );
    }
  }

  const counts = { update: 0, add: 0, delete: 0 };
  for (const item of appliedItems) {
    if (counts[item.action] !== undefined) counts[item.action]++;
  }
  const summaryParts = [];
  if (counts.update) summaryParts.push(`${counts.update} updated`);
  if (counts.add) summaryParts.push(`${counts.add} added`);
  if (counts.delete) summaryParts.push(`${counts.delete} deleted`);
  const summary = `Patched ${appliedItems.length} file${appliedItems.length > 1 ? "s" : ""} (${summaryParts.join(", ")})`;
  showMdPatchToast(summary, appliedItems);

  const hasScadChange = appliedItems.some((i) => isScadFilePath(i.targetPath));
  if (hasScadChange && autoRenderCb.checked && !isGodotPlaying) {
    compileAndRender(getEditorContent());
  }
}

function openPatchModal({ initialPatchText = "", clipboardNotice = "" } = {}) {
  const ctx = getMdFilesContext(editorEl.value);
  openMdPatchModal({
    currentMd: editorEl.value,
    currentFilesMap: ctx.filesMap,
    preferredTargetFile: entryFileSelect.value || currentEntryFile,
    initialPatchText,
    clipboardNotice,
    onApply: async ({ mode, updatedMd, appliedItems }) => {
      if (mode === "replace") {
        await applyMdEditWithHistory({
          nextContent: updatedMd,
          snapshotLabel: "Before replace",
          preserveName: backendSelectEl.value !== "",
          fullReplace: true,
        });
      } else {
        await applyMdEditWithHistory({
          nextContent: updatedMd,
          appliedItems,
          snapshotLabel: "Before patch",
          preserveName: true,
        });
      }
      const visibleActionBtn =
        patchMdBtn && patchMdBtn.style.display !== "none"
          ? patchMdBtn
          : pasteMdFileBtn;
      flashMdActionButton(
        visibleActionBtn,
        mode === "replace" ? "✅ Replaced!" : "✅ Patched!",
      );
    },
  });
}

if (patchMdBtn) {
  patchMdBtn.addEventListener("click", () => {
    openPatchModal();
  });
}

if (mdPatchCloseBtn) {
  mdPatchCloseBtn.addEventListener("click", hideMdPatchToast);
}

if (mdPatchUndoBtn) {
  mdPatchUndoBtn.addEventListener("click", async () => {
    if (!lastPatchUndoState) return;
    const undo = lastPatchUndoState;
    lastPatchUndoState = null;

    isRestoringWorkspace = true;
    try {
      editorEl.value = undo.content;
      modelNameInputEl.value = undo.name;
      currentEntryFile = undo.entryFile;
      currentEntryScadFile = undo.entryScadFile;
    } finally {
      isRestoringWorkspace = false;
    }

    await syncNamedLocalModelContent();
    syncMdFilesUi(editorEl.value);
    checkChanges();
    saveWorkspaceImmediate();
    hideMdPatchToast();
    if (autoRenderCb.checked && !isGodotPlaying) {
      compileAndRender(getEditorContent());
    }
  });
}

if (mdPatchDiffBtn) {
  mdPatchDiffBtn.addEventListener("click", () => {
    openVersionCompareModal({
      activeModelId: activeLocalModelId,
      selectedVersionId: lastPatchUndoState?.preVersionId || "",
      currentName: modelNameInputEl.value,
      currentContent: editorEl.value,
      currentEntryFile,
      fetchDependencies: fetchDependenciesWrapper,
      onRestore: async (snapshot) => {
        if (!snapshot) return;
        await applyMdEditWithHistory({
          nextContent: snapshot.content,
          snapshotLabel: "Before restore",
          preserveName: true,
          fullReplace: true,
        });
      },
    });
  });
}

if (pasteMdFileBtn) {
  pasteMdFileBtn.addEventListener("click", async () => {
    let text = null;
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      alert(
        "Failed to read clipboard: " +
          (err?.message ||
            "Permission denied. Use Ctrl+V / Cmd+V directly in the editor."),
      );
      return;
    }

    await applyMdEditWithHistory({
      nextContent: text,
      snapshotLabel: "Before paste",
      preserveName: false,
      fullReplace: true,
    });
    const visibleActionBtn =
      patchMdBtn && patchMdBtn.style.display !== "none"
        ? patchMdBtn
        : pasteMdFileBtn;
    flashMdActionButton(visibleActionBtn, "✅ Pasted!");
  });
}

// --- Prompt Logic ---
const promptHelpTextEl = promptPanel?.querySelector(".help-text");
if (promptUiContainer) {
  promptUiContainer.innerHTML = PROMPT_UI_HTML;
  setupPromptToggles(promptUiContainer, "scad_editor_prompt_settings", {
    helpTextEl: promptHelpTextEl,
    descEl: promptDescEl,
  });
}

copyPromptBtn.onclick = async () => {
  const desc = promptDescEl.value.trim();
  const promptText = buildPromptFromUI(promptUiContainer, desc);

  try {
    await navigator.clipboard.writeText(promptText);
    const originalText = copyPromptBtn.innerText;
    copyPromptBtn.innerText = "✅ Copied!";
    setTimeout(() => {
      copyPromptBtn.innerText = originalText;
    }, 2000);
  } catch (err) {
    alert("Failed to copy clipboard: " + err);
  }
};

let copyRefinementTimer = null;
if (copyRefinementBtn) {
  copyRefinementBtn.onclick = async () => {
    const projectContent = getEditorContent();
    const ctx = getMdFilesContext(projectContent);
    if (!ctx.isMd || ctx.allFiles.length === 0) return;

    const desc = promptDescEl ? promptDescEl.value.trim() : "";
    const refinementPrompt = buildRefinementPromptFromUI(
      promptUiContainer,
      projectContent,
      {
        refinementRequest: desc,
      },
    );

    try {
      await navigator.clipboard.writeText(refinementPrompt);
      if (!copyRefinementBtn.dataset.originalText) {
        copyRefinementBtn.dataset.originalText = copyRefinementBtn.innerText;
      }
      copyRefinementBtn.innerText = "✅ Copied!";
      clearTimeout(copyRefinementTimer);
      copyRefinementTimer = setTimeout(() => {
        copyRefinementBtn.innerText =
          copyRefinementBtn.dataset.originalText || "🩹 Copy Refinement Prompt";
      }, 2000);
    } catch (err) {
      alert("Failed to copy clipboard: " + err);
    }
  };
}

// --- SCAD Compilation ---
async function fetchDependenciesWrapper(code) {
  if (!isServerConnected) return {};
  return fetchDependencies(code, currentBackendUrl, null);
}

async function compileAndRender(scadCode) {
  if (typeof scadCode !== "string") return;

  const mdCtx = syncMdFilesUi(scadCode);
  const godotProject = mdCtx.godotProject;
  if (godotProject) {
    isGodotProject = true;
    if (playGodotBtn) {
      playGodotBtn.style.display = "flex";
      playGodotBtn.innerText = isGodotPlaying
        ? "⏹ Stop Godot"
        : "🎮 Play Godot";
    }
    if (downloadGodotZipBtn) {
      downloadGodotZipBtn.style.display = "flex";
    }

    applyDerivedModelName(
      `${godotProject.projectName}.md`,
      pendingForceNameOverride,
    );
    pendingForceNameOverride = false;

    if (isEmbedMode && !isGodotPlaying) {
      launchGodotProject(godotProject);
      return;
    }

    if (isGodotPlaying) {
      return;
    }
  } else {
    isGodotProject = false;
    if (playGodotBtn) playGodotBtn.style.display = "none";
    if (downloadGodotZipBtn) downloadGodotZipBtn.style.display = "none";
    if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
  }

  if (isGodotPlaying) {
    return;
  }

  if (isCompiling) {
    pendingCode = scadCode;
    return;
  }

  const forceNameOverride = pendingForceNameOverride;
  pendingForceNameOverride = false;

  if (scadCode.trim() === "") {
    if (!isGodotProject) {
      applyDerivedModelName(null);
    }
    clearCurrentMesh();
    if (renderTimeEl) renderTimeEl.style.display = "none";
    return;
  }

  let entryCode = scadCode;
  let extractedAdditionalFiles = {};
  let extractedFiles = null;

  const isMd = isMarkdownContent(scadCode);

  if (isMd) {
    const files = extractFilesFromMarkdown(scadCode);
    extractedFiles = files;
    const scadFiles = Object.keys(files).filter((f) => isScadFilePath(f));

    if (scadFiles.length > 0) {
      const targetFile =
        currentEntryFile && scadFiles.includes(currentEntryFile)
          ? currentEntryFile
          : currentEntryScadFile && scadFiles.includes(currentEntryScadFile)
            ? currentEntryScadFile
            : scadFiles[0];
      currentEntryScadFile = targetFile;
      entryCode = files[targetFile];
      for (const [fName, fContent] of Object.entries(files)) {
        if (fName !== targetFile) {
          extractedAdditionalFiles[fName] = fContent;
        }
      }
    } else if (files["main.scad"]) {
      entryCode = files["main.scad"];
    } else {
      clearCurrentMesh();
      if (renderTimeEl) renderTimeEl.style.display = "none";
      if (!isGodotProject) {
        const rootFolder = extractRootFolderFromMarkdownFiles(files);
        applyDerivedModelName(
          rootFolder ? `${rootFolder}.md` : null,
          forceNameOverride,
        );
      }
      return;
    }
  }

  if (!isGodotProject) {
    const extractedName = extractModelNameFromScad(entryCode);
    let derivedName = null;
    if (extractedName) {
      derivedName =
        isMd && !extractedName.toLowerCase().endsWith(".md")
          ? extractedName + ".md"
          : extractedName;
    } else if (isMd && extractedFiles) {
      const rootFolder = extractRootFolderFromMarkdownFiles(extractedFiles);
      if (rootFolder) {
        derivedName = `${rootFolder}.md`;
      }
    }
    applyDerivedModelName(derivedName, forceNameOverride);
  }

  isCompiling = true;

  if (renderTimeEl) {
    renderTimeEl.style.display = "block";
    renderTimeEl.innerText = "Compiling...";
  }

  const startTime = performance.now();

  try {
    const additionalFiles = await fetchDependenciesWrapper(entryCode);
    if (isGodotPlaying) return;
    Object.assign(additionalFiles, extractedAdditionalFiles);

    const opts = {
      wasmUrl: wasmUrl,
      additionalFiles: additionalFiles,
    };

    const gltfData = await convertScadToGltf(entryCode, opts);
    if (isGodotPlaying) return;
    currentGltfData = gltfData;
    await rebuildSceneFromGLTF(currentGltfData);
    if (isGodotPlaying) return;

    if (renderTimeEl) {
      const endTime = performance.now();
      renderTimeEl.innerText = `Rendered in ${((endTime - startTime) / 1000).toFixed(2)}s`;
    }
    maybeCreateAutoVersion("Rendered");
  } catch (e) {
    console.error(e);
    if (renderTimeEl && !isGodotPlaying) {
      renderTimeEl.innerText = "Compilation failed";
    }
  } finally {
    isCompiling = false;
    if (pendingCode !== null) {
      const codeToCompile = pendingCode;
      pendingCode = null;
      if (!isGodotPlaying) {
        compileAndRender(codeToCompile);
      }
    }
  }
}

renderBtn.onclick = () => compileAndRender(getEditorContent());

let renderTimeout;
editorEl.addEventListener("input", () => {
  syncMdFilesUi(editorEl.value);
  checkChanges();
  saveWorkspaceImmediate();
  scheduleAutoVersion();
  clearTimeout(renderTimeout);
  if (!autoRenderCb.checked || isGodotPlaying) {
    return;
  }
  renderTimeout = setTimeout(() => {
    if (!isGodotPlaying) {
      compileAndRender(getEditorContent());
    }
  }, 800);
});

autoRenderCb.addEventListener("change", () => {
  if (autoRenderCb.checked && !isGodotPlaying) {
    compileAndRender(getEditorContent());
  }
});

loadScadBtn.onclick = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".scad,.md";
  input.onchange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      try {
        const file = e.target.files[0];
        const text = await file.text();
        await openModelInLocalStore({
          content: text,
          name: file.name,
          fallbackPrefix: "Local Model",
          versionLabel: "Loaded file",
        });
        checkChanges();
        if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
        compileAndRender(getEditorContent());
      } catch (err) {
        alert("Failed to read file: " + err.message);
      }
    }
  };
  input.click();
};

downloadScadBtn.onclick = () => {
  const codeToSave = getEditorContent();
  const active = getActiveScadTarget(codeToSave);

  if (active) {
    if (!active.targetFile) return;
    downloadBlob(
      new Blob([active.scadContent], { type: "text/plain" }),
      `${active.baseName}.scad`,
    );
    return;
  }

  const baseName = stripModelExtension(getDownloadName()) || "model";
  downloadBlob(
    new Blob([codeToSave], { type: "text/plain" }),
    `${baseName}.scad`,
  );
};

if (downloadMdBtn) {
  downloadMdBtn.onclick = () => {
    const codeToSave = getEditorContent();
    const baseName = stripModelExtension(getDownloadName()) || "model";
    downloadBlob(
      new Blob([codeToSave], { type: "text/plain" }),
      `${baseName}.md`,
    );
  };
}

exportGltfBtn.onclick = () => {
  if (!currentGltfData) return;
  const dlName = getScadExportBaseName(getEditorContent());
  downloadBlob(
    new Blob([currentGltfData], { type: "application/octet-stream" }),
    `${dlName}.glb`,
  );
};

export3mfBtn.onclick = async () => {
  let scadCode = getEditorContent();
  if (!scadCode || scadCode.trim() === "") return;

  const originalText = export3mfBtn.innerText;
  export3mfBtn.innerText = "⏳ Exporting...";
  export3mfBtn.disabled = true;

  let entryCode = scadCode;
  let extractedAdditionalFiles = {};

  const isMd = isMarkdownContent(scadCode);

  if (isMd) {
    const files = extractFilesFromMarkdown(scadCode);
    const scadFiles = Object.keys(files).filter((f) => isScadFilePath(f));
    const targetFile =
      (currentEntryFile && scadFiles.includes(currentEntryFile)
        ? currentEntryFile
        : currentEntryScadFile && scadFiles.includes(currentEntryScadFile)
          ? currentEntryScadFile
          : scadFiles[0]) || "main.scad";

    if (files[targetFile]) {
      entryCode = files[targetFile];
    }
    for (const [fName, fContent] of Object.entries(files)) {
      if (fName !== targetFile) {
        extractedAdditionalFiles[fName] = fContent;
      }
    }
  }

  try {
    const additionalFiles = await fetchDependenciesWrapper(entryCode);
    Object.assign(additionalFiles, extractedAdditionalFiles);

    const opts = {
      wasmUrl: wasmUrl,
      additionalFiles: additionalFiles,
      lazyUnion: true,
    };

    const threeMfData = await convertScadTo3MF(entryCode, opts);
    const dlName = getScadExportBaseName(scadCode);

    downloadBlob(
      new Blob([threeMfData], { type: "application/octet-stream" }),
      `${dlName}.3mf`,
    );
  } catch (e) {
    console.error(e);
    alert("Failed to export 3MF: " + e.message);
  } finally {
    export3mfBtn.innerText = originalText;
    export3mfBtn.disabled = false;
  }
};

function updateCaptureButtonState() {
  const { currentAction, isPlaying } = animController.getState();
  if (activeVideoRecorder) {
    captureImageBtn.innerText = "🔴 Rec...";
  } else if (currentAction && isPlaying) {
    captureImageBtn.innerText = "🎥 Video";
  } else {
    captureImageBtn.innerText = "📷 Image";
  }
}

captureImageBtn.onclick = () => {
  if (activeVideoRecorder) {
    activeVideoRecorder.stop();
    return;
  }

  const { mixer, currentAction, isPlaying } = animController.getState();
  if (currentAction && isPlaying) {
    const recorder = startAnimationVideoRecording({
      activeCamera,
      viewerCtx,
      viewerEl,
      mixer,
      currentAction,
      isPathTracing: Boolean(pathTracingCb && pathTracingCb.checked),
      showGrid: showGridCb ? showGridCb.checked : true,
      sceneHasLights,
      useCustomLights: lightsCb ? lightsCb.checked : true,
      getBaseFilename: () => getScadExportBaseName(getEditorContent()),
      onFinished: () => {
        activeVideoRecorder = null;
        updateCaptureButtonState();
      },
    });
    if (recorder) {
      activeVideoRecorder = recorder;
      updateCaptureButtonState();
    } else {
      alert("Video recording is not supported in this browser.");
    }
  } else {
    captureNextFrame = true;
  }
};

// --- Share Logic ---
shareBtn.onclick = async () => {
  const originalText = shareBtn.innerText;
  shareBtn.innerText = "⏳ Preparing...";
  shareBtn.disabled = true;

  let finalUrl = "";

  try {
    const rawCode = editorEl.value;
    const shouldEmbed = Boolean(embedShareCb && embedShareCb.checked);
    const url = new URL(window.location.href);

    if (shouldEmbed) {
      url.searchParams.set("embed", "1");
    } else {
      url.searchParams.delete("embed");
    }
    url.searchParams.delete("file");

    if (!rawCode.trim()) {
      finalUrl = url.origin + url.pathname + url.search;
    } else {
      // 1. Parse current editor content to see if it's already a bundle
      let filesToShare = {};
      const isMd = isMarkdownContent(rawCode);

      if (isMd) {
        filesToShare = extractFilesFromMarkdown(rawCode);
      } else {
        let mainName = modelNameInputEl.value.trim() || "main.scad";
        if (
          !mainName.toLowerCase().endsWith(".scad") &&
          !mainName.toLowerCase().endsWith(".md")
        ) {
          mainName += ".scad";
        }
        filesToShare[mainName] = rawCode;
      }

      // 2. Auto-fetch all dependencies automatically (if connected to local backend)
      let allCode = Object.values(filesToShare).join("\n");
      const additionalFiles = await fetchDependenciesWrapper(allCode);
      const addedDeps = Object.entries(additionalFiles).filter(
        ([depPath]) => !filesToShare[depPath],
      );

      // 3. Build the final string to encode
      let finalCodeToEncode = "";

      if (addedDeps.length === 0) {
        finalCodeToEncode = rawCode;
      } else if (isMd) {
        let extraBlocks = "";
        for (const [depPath, depContent] of addedDeps) {
          const lang = getMarkdownLangFromPath(depPath);
          const fence = getSafeFenceForContent(depContent);
          extraBlocks += `### ${depPath}\n${fence}${lang}\n${depContent}\n${fence}\n\n`;
        }
        const sep = rawCode.endsWith("\n\n")
          ? ""
          : rawCode.endsWith("\n")
            ? "\n"
            : "\n\n";
        finalCodeToEncode = rawCode + sep + extraBlocks;
      } else {
        const mainName = Object.keys(filesToShare)[0];
        const mainLang = getMarkdownLangFromPath(mainName);
        const mainFence = getSafeFenceForContent(rawCode);
        finalCodeToEncode = `### ${mainName}\n${mainFence}${mainLang}\n${rawCode}\n${mainFence}\n\n`;
        for (const [depPath, depContent] of addedDeps) {
          const lang = getMarkdownLangFromPath(depPath);
          const fence = getSafeFenceForContent(depContent);
          finalCodeToEncode += `### ${depPath}\n${fence}${lang}\n${depContent}\n${fence}\n\n`;
        }
      }

      // 4. Compress and apply hash to URL
      const hash = await encodeCode(finalCodeToEncode);
      url.hash = hash;
      finalUrl = url.toString();
    }

    // 6. Trigger native Share or Clipboard
    if (navigator.share) {
      let rawName = modelNameInputEl.value.trim();
      if (rawName.toLowerCase().endsWith(".md")) {
        rawName = rawName.substring(0, rawName.length - 3);
      }
      const displayTitle = rawName
        ? rawName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "Scadify";

      await navigator.share({
        title: displayTitle,
        url: finalUrl,
      });
      shareBtn.innerText = "✅ Shared!";
    } else {
      await navigator.clipboard.writeText(finalUrl);
      shareBtn.innerText = "✅ Copied Link!";
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      try {
        await navigator.clipboard.writeText(finalUrl || window.location.href);
        shareBtn.innerText = "✅ Copied Link!";
      } catch (fallbackErr) {
        alert("Failed to share or copy link.");
      }
    }
  } finally {
    // Reset button after 2 seconds
    setTimeout(() => {
      shareBtn.innerText = originalText;
      shareBtn.disabled = false;
    }, 2000);
  }
};

function appendGodotLog(text, level = "info") {
  if (!godotLogsOutput || !text) return;
  const prefix = level === "error" ? "[ERR] " : "";
  godotLogsOutput.textContent += `${prefix}${text}\n`;
  godotLogsOutput.scrollTop = godotLogsOutput.scrollHeight;
  if (level === "error" && godotLogsDrawer) {
    godotLogsDrawer.style.display = "flex";
  }
}

function setScadViewerUiVisible(visible) {
  if (viewerEl) viewerEl.style.display = visible ? "" : "none";
  if (viewerControlsEl) viewerControlsEl.style.display = visible ? "" : "none";
  if (renderTimeEl && !visible) renderTimeEl.style.display = "none";
  if (animControlsSection) {
    animControlsSection.style.display =
      visible &&
      currentMesh &&
      (currentAnimations.length > 0 || gltfCameras.length > 0)
        ? "flex"
        : "none";
  }
  if (renderBtn) renderBtn.style.display = visible ? "" : "none";
  if (exportGltfBtn) exportGltfBtn.style.display = visible ? "" : "none";
  if (export3mfBtn) export3mfBtn.style.display = visible ? "" : "none";
  if (captureImageBtn) captureImageBtn.style.display = visible ? "" : "none";
  if (autoRenderCb?.parentElement) {
    autoRenderCb.parentElement.style.display = visible ? "" : "none";
  }
  if (pathTracingCb?.parentElement) {
    pathTracingCb.parentElement.style.display = visible ? "" : "none";
  }
}

function suspendScadViewer() {
  clearTimeout(renderTimeout);
  pendingCode = null;
  captureNextFrame = false;
  stopScadViewerLoop();
  clearCurrentMesh();
  currentAnimations = [];
  currentGltfData = null;
  gltfCameras = [];
  gltfLights = [];
  sceneHasLights = false;
  activeCamera = camera;
  controls.enabled = true;
  const lightsCbLabel = document.getElementById("lights-cb-label");
  if (lightsCbLabel) lightsCbLabel.style.display = "none";
  if (renderer.renderLists) renderer.renderLists.dispose();
}

function stopGodotPlayer(options = {}) {
  const { skipCompile = false } = options;
  godotRunToken++;
  isGodotPlaying = false;
  if (godotIframe) {
    godotIframe.remove();
    godotIframe = null;
  }
  if (godotStatusOverlay) godotStatusOverlay.style.display = "none";
  if (godotLogsDrawer) godotLogsDrawer.style.display = "none";
  if (godotPanel) godotPanel.style.display = "none";
  setScadViewerUiVisible(true);
  if (playGodotBtn) playGodotBtn.innerText = "🎮 Play Godot";
  startScadViewerLoop();
  window.dispatchEvent(new Event("resize"));
  if (!skipCompile && !currentMesh) {
    const content = getEditorContent();
    const project = parseGodotMarkdownProject(content);
    const hasScad =
      !project || Object.keys(project.files).some((f) => isScadFilePath(f));
    if (content.trim() && hasScad) {
      compileAndRender(content);
    }
  }
}

async function launchGodotProject(project) {
  if (!project) return;
  const token = ++godotRunToken;

  if (godotIframe) {
    godotIframe.remove();
    godotIframe = null;
  }

  isGodotPlaying = true;
  suspendScadViewer();
  setScadViewerUiVisible(false);
  if (playGodotBtn) playGodotBtn.innerText = "⏹ Stop Godot";
  if (godotPanel) godotPanel.style.display = "flex";
  if (godotLogsOutput) godotLogsOutput.textContent = "";
  if (godotStatusOverlay) {
    godotStatusOverlay.style.display = "block";
    godotStatusOverlay.innerText = "Preparing Godot project...";
  }

  try {
    const { pckBuffer, logs, compiledCount } = await compileGodotProjectToPck(
      project,
      {
        wasmUrl,
        scadCache: godotScadCache,
        onProgress: (msg) => {
          if (token === godotRunToken && godotStatusOverlay) {
            godotStatusOverlay.innerText = msg;
          }
        },
      },
    );

    if (token !== godotRunToken) return;

    logs.forEach((l) => appendGodotLog(l));
    appendGodotLog(
      `[Web] Packed ${project.projectName} (${compiledCount} SCAD model(s), ${(pckBuffer.byteLength / 1024).toFixed(1)} KB .pck)`,
    );

    if (godotStatusOverlay) {
      godotStatusOverlay.innerText = "Starting Godot Web Runtime...";
    }

    const iframe = document.createElement("iframe");
    iframe.src = "./godot-player.html";
    iframe.allow = "fullscreen; autoplay";
    iframe.allowFullscreen = true;
    godotIframe = iframe;
    godotViewport.innerHTML = "";
    godotViewport.appendChild(iframe);

    const pckArrayBuffer = pckBuffer.buffer.slice(
      pckBuffer.byteOffset,
      pckBuffer.byteOffset + pckBuffer.byteLength,
    );

    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (token !== godotRunToken) {
        window.removeEventListener("message", onMessage);
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "GODOT_PLAYER_READY") {
        iframe.contentWindow.postMessage(
          {
            type: "START_GODOT",
            pckBuffer: pckArrayBuffer,
            godotBaseUrl: "./godot/godot",
          },
          "*",
          [pckArrayBuffer],
        );
      } else if (data.type === "GODOT_STARTED") {
        if (godotStatusOverlay) godotStatusOverlay.style.display = "none";
      } else if (data.type === "GODOT_LOG") {
        appendGodotLog(data.text, data.level);
      } else if (data.type === "GODOT_ERROR") {
        if (godotStatusOverlay) {
          godotStatusOverlay.style.display = "block";
          godotStatusOverlay.innerText = `Godot Error:\n${data.message}`;
        }
        appendGodotLog(data.message, "error");
      } else if (data.type === "GODOT_EXIT") {
        appendGodotLog(`[Godot] Process exited with code ${data.code}`);
      } else if (data.type === "GODOT_SCREENSHOT" && data.dataUrl) {
        fetch(data.dataUrl)
          .then((r) => r.blob())
          .then((blob) => {
            let dlName = getDownloadName().replace(/\.(md|scad)$/i, "");
            downloadBlob(blob, `${dlName}.png`);
          });
      }
    };

    window.addEventListener("message", onMessage);
  } catch (err) {
    if (token !== godotRunToken) return;
    const msg = err?.message || String(err);
    if (godotStatusOverlay) {
      godotStatusOverlay.style.display = "block";
      godotStatusOverlay.innerText = `Build Failed:\n${msg}`;
    }
    appendGodotLog(msg, "error");
  }
}

if (playGodotBtn) {
  playGodotBtn.onclick = () => {
    if (isGodotPlaying) {
      stopGodotPlayer();
      return;
    }
    const project = parseGodotMarkdownProject(getEditorContent());
    if (project) launchGodotProject(project);
  };
}
if (downloadGodotZipBtn) {
  downloadGodotZipBtn.onclick = async () => {
    const project = parseGodotMarkdownProject(getEditorContent());
    if (!project) return;

    const originalText = downloadGodotZipBtn.innerText;
    downloadGodotZipBtn.disabled = true;
    downloadGodotZipBtn.innerText = "⏳ Building...";

    try {
      let dlName = getDownloadName().replace(/\.(md|scad)$/i, "");
      if (!dlName || dlName === "model") {
        dlName = project.projectName || "godot_project";
      }

      const { zipBlob } = await exportGodotProjectWebZip(project, {
        wasmUrl,
        godotBaseUrl: "./godot/godot",
        folderName: dlName,
        scadCache: godotScadCache,
        onProgress: (msg) => {
          if (/SCAD/i.test(msg)) {
            downloadGodotZipBtn.innerText = "⏳ Compiling...";
          } else if (/Packing/i.test(msg)) {
            downloadGodotZipBtn.innerText = "⏳ Packing...";
          } else if (/runtime/i.test(msg)) {
            downloadGodotZipBtn.innerText = "⏳ Runtime...";
          } else if (/ZIP/i.test(msg)) {
            const pct = msg.match(/(\d+%)/);
            downloadGodotZipBtn.innerText = pct
              ? `⏳ Zip ${pct[1]}`
              : "⏳ Zipping...";
          }
        },
      });

      downloadBlob(zipBlob, `${dlName}_web.zip`);
    } catch (err) {
      console.error(err);
      alert("Failed to export Godot Web ZIP: " + (err?.message || err));
    } finally {
      downloadGodotZipBtn.innerText = originalText;
      downloadGodotZipBtn.disabled = false;
    }
  };
}
if (downloadProjectZipBtn) {
  downloadProjectZipBtn.onclick = async () => {
    const project = parseMarkdownProject(getEditorContent());
    if (!project) return;

    const originalText = downloadProjectZipBtn.innerText;
    downloadProjectZipBtn.disabled = true;
    downloadProjectZipBtn.innerText = "⏳ Zipping...";

    try {
      let dlName = getDownloadName().replace(/\.(md|scad)$/i, "");
      if (!dlName || dlName === "model") {
        dlName = project.projectName || "project";
      }

      const { zipBlob, rootFolderName } = await exportProjectZip(project, {
        wasmUrl,
        folderName: dlName,
        scadCache: godotScadCache,
        onProgress: (msg) => {
          if (/SCAD/i.test(msg)) {
            downloadProjectZipBtn.innerText = "⏳ Compiling...";
          } else {
            const pct = msg.match(/(\d+%)/);
            downloadProjectZipBtn.innerText = pct
              ? `⏳ Zip ${pct[1]}`
              : "⏳ Zipping...";
          }
        },
      });

      downloadBlob(zipBlob, `${rootFolderName}.zip`);
    } catch (err) {
      console.error(err);
      alert("Failed to export project ZIP: " + (err?.message || err));
    } finally {
      downloadProjectZipBtn.innerText = originalText;
      downloadProjectZipBtn.disabled = false;
    }
  };
}
if (godotRestartBtn) {
  godotRestartBtn.onclick = () => {
    const project = parseGodotMarkdownProject(getEditorContent());
    if (project) launchGodotProject(project);
  };
}
if (godotStopBtn) {
  godotStopBtn.onclick = () => stopGodotPlayer();
}
if (godotLogsBtn && godotLogsDrawer) {
  godotLogsBtn.onclick = () => {
    godotLogsDrawer.style.display =
      godotLogsDrawer.style.display === "none" ? "flex" : "none";
  };
}
if (godotLogsCopyBtn && godotLogsOutput) {
  let copyLogsTimer = null;
  godotLogsCopyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(godotLogsOutput.textContent || "");
      if (!godotLogsCopyBtn.dataset.originalText) {
        godotLogsCopyBtn.dataset.originalText = godotLogsCopyBtn.innerText;
      }
      godotLogsCopyBtn.innerText = "✅ Copied!";
      clearTimeout(copyLogsTimer);
      copyLogsTimer = setTimeout(() => {
        godotLogsCopyBtn.innerText =
          godotLogsCopyBtn.dataset.originalText || "Copy";
      }, 1500);
    } catch (err) {
      alert("Failed to copy logs to clipboard: " + err);
    }
  };
}
if (godotLogsClearBtn && godotLogsOutput) {
  godotLogsClearBtn.onclick = () => {
    godotLogsOutput.textContent = "";
  };
}
if (godotScreenshotBtn) {
  godotScreenshotBtn.onclick = () => {
    if (godotIframe && godotIframe.contentWindow) {
      godotIframe.contentWindow.postMessage(
        { type: "CAPTURE_SCREENSHOT" },
        "*",
      );
    }
  };
}

function appendUePanelLog(text) {
  if (!ueLogsOutput || !text) return;
  ueLogsOutput.textContent += text;
  ueLogsOutput.scrollTop = ueLogsOutput.scrollHeight;
}

function updateUeStatusUi(data) {
  if (!data) return;
  isUeRunning = Boolean(data.running);

  if (runUeBtn) {
    runUeBtn.innerText = isUeRunning ? "⏹ Stop UE" : "🎮 Run UE";
  }
  if (ueStopBtn) {
    ueStopBtn.disabled = !isUeRunning;
  }
  if (ueStatusBadge) {
    ueStatusBadge.className = "ue-status-badge";
    const st = data.status || "idle";
    if (st === "building") {
      ueStatusBadge.textContent = "Building C++...";
      ueStatusBadge.classList.add("is-building");
    } else if (st === "running") {
      ueStatusBadge.textContent = "Running UE";
      ueStatusBadge.classList.add("is-running");
    } else if (st === "error") {
      ueStatusBadge.textContent = "Error";
      ueStatusBadge.classList.add("is-error");
    } else if (st === "stopped") {
      ueStatusBadge.textContent = "Stopped";
      ueStatusBadge.classList.add("is-stopped");
    } else {
      ueStatusBadge.textContent = "Idle";
    }
  }
}

async function refreshUeBackendStatus() {
  if (!isServerConnected || !currentBackendUrl) return null;
  try {
    const res = await fetch(
      `${currentBackendUrl}/api/ue/status?since=${ueLogOffset}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.logs) {
      appendUePanelLog(data.logs);
    }
    if (typeof data.nextOffset === "number") {
      ueLogOffset = data.nextOffset;
    }
    updateUeStatusUi(data);
    return data;
  } catch {
    return null;
  }
}

function startUeStatusPolling() {
  clearTimeout(uePollTimer);
  const tick = async () => {
    const data = await refreshUeBackendStatus();
    if (data && data.running) {
      uePollTimer = setTimeout(tick, 500);
    }
  };
  uePollTimer = setTimeout(tick, 300);
}

async function runUeProject() {
  const project = parseMarkdownProject(getEditorContent());
  if (!project || project.projectType !== "ue") return;

  if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
  if (uePanel) uePanel.style.display = "flex";
  if (ueLogsOutput) ueLogsOutput.textContent = "";
  ueLogOffset = 0;

  if (!isServerConnected && backendUrlEl) {
    await connectToServer(backendUrlEl.value.trim(), true);
  }

  if (!isServerConnected) {
    updateUeStatusUi({ status: "error", running: false });
    if (ueStatusBadge) ueStatusBadge.textContent = "Backend Offline";
    appendUePanelLog(
      "Cannot launch Unreal Editor directly from the browser.\n" +
        "Start the local backend (`scad-gltf serve --ue-root <path>`) and click Connect under 'SCAD Serve Backend', then click Run UE again.\n",
    );
    return;
  }

  updateUeStatusUi({ status: "building", running: true });
  if (ueStatusBadge) ueStatusBadge.textContent = "Starting...";

  try {
    const res = await fetch(`${currentBackendUrl}/api/ue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: getEditorContent(),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      updateUeStatusUi({ status: "error", running: false });
      appendUePanelLog(
        `❌ ${data.error || "Failed to start Unreal Engine."}\n`,
      );
      return;
    }

    startUeStatusPolling();
  } catch (err) {
    updateUeStatusUi({ status: "error", running: false });
    appendUePanelLog(`❌ Request failed: ${err?.message || err}\n`);
  }
}

async function stopUeProject() {
  clearTimeout(uePollTimer);
  if (!isServerConnected || !currentBackendUrl) {
    updateUeStatusUi({ status: "stopped", running: false });
    return;
  }
  try {
    await fetch(`${currentBackendUrl}/api/ue/stop`, { method: "POST" });
  } catch {}
  await refreshUeBackendStatus();
}

if (runUeBtn) {
  runUeBtn.onclick = () => {
    if (isUeRunning) {
      stopUeProject();
    } else {
      runUeProject();
    }
  };
}
if (ueRestartBtn) {
  ueRestartBtn.onclick = () => runUeProject();
}
if (ueStopBtn) {
  ueStopBtn.onclick = () => stopUeProject();
}
if (ueCloseBtn && uePanel) {
  ueCloseBtn.onclick = () => {
    uePanel.style.display = "none";
  };
}
if (ueLogsCopyBtn && ueLogsOutput) {
  let copyUeLogsTimer = null;
  ueLogsCopyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(ueLogsOutput.textContent || "");
      if (!ueLogsCopyBtn.dataset.originalText) {
        ueLogsCopyBtn.dataset.originalText = ueLogsCopyBtn.innerText;
      }
      ueLogsCopyBtn.innerText = "✅ Copied!";
      clearTimeout(copyUeLogsTimer);
      copyUeLogsTimer = setTimeout(() => {
        ueLogsCopyBtn.innerText =
          ueLogsCopyBtn.dataset.originalText || "Copy Logs";
      }, 1500);
    } catch (err) {
      alert("Failed to copy logs to clipboard: " + err);
    }
  };
}
if (ueLogsClearBtn && ueLogsOutput) {
  ueLogsClearBtn.onclick = () => {
    ueLogsOutput.textContent = "";
  };
}

let isExpandedMode = false;
let isEmbedMode = false;

function hasEmbedParam() {
  const params = new URLSearchParams(window.location.search);
  const val = params.get("embed");
  return val === "1" || val === "true";
}

function setExpandedMode(expanded) {
  isExpandedMode = Boolean(expanded);
  if (appContainer) {
    appContainer.classList.toggle("expanded", isExpandedMode);
  }
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function setEmbedMode(enabled) {
  isEmbedMode = Boolean(enabled);
  document.documentElement.classList.toggle("embed-mode", isEmbedMode);
  if (appContainer) {
    appContainer.classList.toggle("embed-mode", isEmbedMode);
  }
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

if (expandBtn) {
  expandBtn.addEventListener("click", () => setExpandedMode(true));
}
if (godotExpandBtn) {
  godotExpandBtn.addEventListener("click", () => setExpandedMode(true));
}
if (exitExpandBtn) {
  exitExpandBtn.addEventListener("click", () => setExpandedMode(false));
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isExpandedMode && !isEmbedMode) {
    setExpandedMode(false);
  }
});

// --- Drag and Drop SCAD / HDR ---
const dragOverlay = document.getElementById("drag-overlay");
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragOverlay.classList.add("active");
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  dragOverlay.classList.add("active");
});
dragOverlay.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragOverlay.classList.remove("active");
});

window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragOverlay.classList.remove("active");

  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".hdr")) {
      const url = URL.createObjectURL(file);
      viewerCtx.loadHdrFromUrl(
        url,
        () => {
          viewerCtx.applyPathTracingBackground(
            Boolean(pathTracingCb && pathTracingCb.checked),
          );
          if (pathTracer) {
            pathTracer.setScene(scene, activeCamera);
            pathTracer.updateCamera();
          }
          URL.revokeObjectURL(url);
        },
        () => {
          URL.revokeObjectURL(url);
          alert("Failed to load HDR file.");
        },
      );
    } else if (
      fileName.endsWith(".scad") ||
      fileName.endsWith(".md") ||
      !file.type ||
      file.type.includes("text")
    ) {
      try {
        const text = await file.text();
        await openModelInLocalStore({
          content: text,
          name: file.name,
          fallbackPrefix: "Local Model",
          versionLabel: "Dropped file",
        });
        checkChanges();
        if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
        compileAndRender(getEditorContent());
      } catch (err) {
        alert("Failed to read file: " + err.message);
      }
    } else {
      alert("Please drop a valid .scad, .md, or .hdr file.");
    }
  }
});

// --- Backend Integration ---
let serverFiles = null;
let currentBackendUrl = "";

async function fetchBackendFiles(url) {
  const res = await fetch(`${url}/api/scads`);
  if (!res.ok) throw new Error("Failed to fetch files");
  const data = await res.json();
  return data.files;
}

function renderBackendSelect() {
  backendSelectEl.innerHTML =
    '<option value="">-- Create New Model --</option>';
  if (Array.isArray(serverFiles)) {
    serverFiles.forEach((filename, index) => {
      const opt = document.createElement("option");
      opt.value = index;
      opt.innerText = filename;
      backendSelectEl.appendChild(opt);
    });
  }
  backendSelectEl.value = currentSelectedModelIdx;

  if (backendDeleteBtn) {
    backendDeleteBtn.style.display =
      currentSelectedModelIdx === "" ? "none" : "flex";
  }
}

function getSanitizedNames() {
  let filename = modelNameInputEl.value.trim();

  if (filename) {
    filename = filename.split(/[/\\]/).pop();
    if (!filename.endsWith(".scad") && !filename.endsWith(".md")) {
      filename += ".scad";
    }
  }

  return { filename };
}

function checkChanges() {
  if (serverFiles === null) return;

  const isNew = backendSelectEl.value === "";
  const { filename } = getSanitizedNames();
  const currentContent = editorEl.value;

  let scadChanged = false;

  if (isNew) {
    if (
      (filename && filename !== ".scad" && filename !== ".md") ||
      currentContent.trim() !== ""
    ) {
      scadChanged = true;
    }
  } else {
    if (currentContent !== currentModelOriginalState.content) {
      scadChanged = true;
    }
  }

  if (scadChanged) {
    backendSingleSaveBtn.style.display = "flex";
    backendSingleSaveBtn.innerText = "Save";
  } else {
    backendSingleSaveBtn.style.display = "none";
  }
}

async function connectToServer(url, isAutoConnect = false) {
  if (!url) return false;
  try {
    backendConnectBtn.innerText = "Connecting...";
    serverFiles = await fetchBackendFiles(url);
    currentBackendUrl = url;
    isServerConnected = true;

    backendConnectBtn.innerText = "Connected";
    backendUiEl.classList.add("active");
    refreshUeBackendStatus().then((data) => {
      if (data && data.running) {
        startUeStatusPolling();
      }
    });

    editorEl.placeholder = "Enter OpenSCAD code here...";

    currentSelectedModelIdx = "";
    renderBackendSelect();

    currentModelOriginalState = {
      isNew: true,
      content: "",
    };
    checkChanges();

    return true;
  } catch (err) {
    if (!isAutoConnect) {
      alert("Connection failed: " + err.message);
    } else {
      console.warn("Auto-connect failed:", err.message);
    }
    backendConnectBtn.innerText = "Connect";
    backendUiEl.classList.remove("active");
    isServerConnected = false;
    editorEl.placeholder = "Enter OpenSCAD code here...";

    return false;
  }
}

backendConnectBtn.onclick = async () => {
  const url = backendUrlEl.value.trim();
  const success = await connectToServer(url, false);
  if (success) {
    compileAndRender(getEditorContent());
  }
};

backendSelectEl.addEventListener("change", async () => {
  const hasUnsavedChanges = backendSingleSaveBtn.style.display !== "none";
  if (hasUnsavedChanges) {
    const confirmDiscard = confirm(
      "You have unsaved changes. Are you sure you want to discard them and load another model?",
    );
    if (!confirmDiscard) {
      backendSelectEl.value = currentSelectedModelIdx;
      return;
    }
  }

  const idx = backendSelectEl.value;
  currentSelectedModelIdx = idx;

  if (backendDeleteBtn) {
    backendDeleteBtn.style.display = idx === "" ? "none" : "flex";
  }

  autoDerivedModelName = null;
  pendingForceNameOverride = false;

  if (idx === "") {
    await persistCurrentActiveModel("Before new model");
    isRestoringWorkspace = true;
    try {
      activeLocalModelId = DRAFT_MODEL_ID;
      modelNameInputEl.value = "";
      editorEl.value = "";
      currentEntryFile = null;
      currentEntryScadFile = null;
    } finally {
      isRestoringWorkspace = false;
    }
    await saveLocalModel({
      id: DRAFT_MODEL_ID,
      name: "",
      content: "",
      entryFile: null,
    });
    syncMdFilesUi("");
    saveWorkspaceImmediate();
    await refreshLocalModelsUi();
    await refreshVersionsUi();
    if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
    compileAndRender(getEditorContent());

    currentModelOriginalState = {
      isNew: true,
      content: "",
    };
    checkChanges();
  } else {
    const filename = serverFiles[idx];

    try {
      const res = await fetch(
        `${currentBackendUrl}/api/scads/${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to load model");
      }
      const data = await res.json();
      await openModelInLocalStore({
        content: data.content,
        name: filename,
        fallbackPrefix: "Local Model",
        versionLabel: "Backend model",
      });
      if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
      compileAndRender(getEditorContent());

      currentModelOriginalState = {
        isNew: false,
        content: data.content,
      };
      checkChanges();
    } catch (err) {
      alert("Error loading model: " + err.message);
    }
  }
});

backendSingleSaveBtn.onclick = async () => {
  const { filename } = getSanitizedNames();

  if (!filename || filename === ".scad" || filename === ".md") {
    const originalText = backendSingleSaveBtn.innerText;
    backendSingleSaveBtn.innerText = "⚠️ Name Required!";
    backendSingleSaveBtn.style.borderColor = "#ff4444";
    modelNameInputEl.focus();
    setTimeout(() => {
      backendSingleSaveBtn.innerText = originalText;
      backendSingleSaveBtn.style.borderColor = "";
    }, 2000);
    return;
  }

  const isNew = backendSelectEl.value === "";
  if (isNew && serverFiles && serverFiles.includes(filename)) {
    if (
      !confirm(
        `A file named "${filename}" already exists. Are you sure you want to overwrite it?`,
      )
    ) {
      return;
    }
  }

  const payload = {
    filename,
    content: editorEl.value,
  };

  try {
    backendSingleSaveBtn.innerText = "Saving...";
    const res = await fetch(`${currentBackendUrl}/api/scads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || "Save failed");
    }

    serverFiles = await fetchBackendFiles(currentBackendUrl);

    const newIdx = serverFiles.findIndex((f) => f === filename);
    if (newIdx >= 0) {
      currentSelectedModelIdx = newIdx.toString();
    } else {
      currentSelectedModelIdx = "";
    }

    renderBackendSelect();

    currentModelOriginalState = {
      isNew: false,
      content: editorEl.value,
    };
    checkChanges();
  } catch (err) {
    checkChanges();
    alert("Error: " + err.message);
  }
};

backendDeleteBtn.onclick = async () => {
  const idx = backendSelectEl.value;
  if (idx === "") return;

  const filename = serverFiles[idx];
  if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
    return;
  }

  try {
    backendDeleteBtn.innerText = "Deleting...";

    const res = await fetch(
      `${currentBackendUrl}/api/scads/${encodeURIComponent(filename)}`,
      {
        method: "DELETE",
      },
    );

    if (!res.ok) {
      let errorMsg = "Delete failed";
      try {
        const errData = await res.json();
        if (errData.error) errorMsg = errData.error;
      } catch (e) {}
      throw new Error(errorMsg);
    }

    serverFiles = await fetchBackendFiles(currentBackendUrl);

    currentSelectedModelIdx = "";
    renderBackendSelect();

    autoDerivedModelName = null;
    pendingForceNameOverride = false;
    modelNameInputEl.value = "";
    editorEl.value = "";
    compileAndRender(getEditorContent());

    currentModelOriginalState = {
      isNew: true,
      content: "",
    };
    checkChanges();
    backendDeleteBtn.innerText = "Delete";
  } catch (err) {
    alert("Error: " + err.message);
    backendDeleteBtn.innerText = "Delete";
  }
};

// --- Three.js Setup ---
const pathTracingCb = document.getElementById("path-tracing-cb");

function syncMainEnvironmentVisibility(forcePathTracing = null) {
  const isPT =
    forcePathTracing !== null
      ? forcePathTracing
      : Boolean(pathTracingCb && pathTracingCb.checked);
  viewerCtx.syncEnvironmentVisibility({
    isPathTracing: isPT,
    showGrid: showGridCb ? showGridCb.checked : true,
    sceneHasLights,
    useCustomLights: lightsCb ? lightsCb.checked : true,
  });
}

const viewerCtx = createViewerContext({
  containerEl: viewerEl,
  preserveDrawingBuffer: true,
  PathTracerClass: WebGLPathTracer,
  onControlsChange: () => {
    if (viewerCtx?.pathTracer) viewerCtx.pathTracer.updateCamera();
  },
  onHdrLoaded: (_texture, ctx) => {
    if (isGodotPlaying) return;
    const isPT = Boolean(pathTracingCb && pathTracingCb.checked);
    syncMainEnvironmentVisibility(isPT);
    ctx.applyPathTracingBackground(isPT);
    if (ctx.pathTracer) {
      ctx.pathTracer.setScene(ctx.scene, activeCamera);
      ctx.pathTracer.updateCamera();
    }
  },
});

const {
  scene,
  camera,
  renderer,
  composer,
  renderPass,
  controls,
  dirLight,
  floor,
  gridHelper,
  axesHelper,
  pathTracer,
} = viewerCtx;

activeCamera = camera;

const animController = createAnimationController({
  animControlsEl: animControlsSection,
  animPlayBtn,
  animSelect,
  animSlider,
  animSliderRow,
  animTimelineLabel,
  animTimelineCb,
  onPlayStateChange: () => updateCaptureButtonState(),
  onScrub: () => {
    if (pathTracingCb && pathTracingCb.checked && pathTracer) {
      syncMainEnvironmentVisibility(true);
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  },
});

if (pathTracingCb) {
  pathTracingCb.addEventListener("change", () => {
    const isPT = pathTracingCb.checked;
    syncMainEnvironmentVisibility(isPT);
    viewerCtx.applyPathTracingBackground(isPT);
    if (isPT && pathTracer) {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  });
}

bindViewerControls({
  wireframeCb,
  bloomCb,
  lightsCb,
  screenshotBtn,
  cameraSelect,
  onWireframeChange: (isWireframe, isBloom) => {
    viewerCtx.applyBloom(isBloom, isWireframe);
    if (currentMesh) {
      setupMeshShadowsAndWireframe(currentMesh, isWireframe);
    }
  },
  onBloomChange: (isBloom, isWireframe) => {
    viewerCtx.applyBloom(isBloom, isWireframe);
  },
  onLightsChange: (useLights) => {
    const isPT = Boolean(pathTracingCb && pathTracingCb.checked);
    gltfLights.forEach((l) => (l.visible = useLights));
    scene.environmentIntensity = sceneHasLights && useLights ? 0.0 : 0.8;
    renderer.toneMappingExposure =
      sceneHasLights && useLights ? currentOptimalExposure : 1.0;

    syncMainEnvironmentVisibility(isPT);

    if (isPT && pathTracer) {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  },
  onCameraChange: (val) => {
    if (val === "") {
      activeCamera = camera;
      controls.enabled = true;
    } else {
      activeCamera = gltfCameras[parseInt(val, 10)];
      controls.enabled = false;
    }
    updateCameraAspect(
      activeCamera,
      viewerEl.clientWidth,
      viewerEl.clientHeight,
    );
    renderPass.camera = activeCamera;

    if (pathTracingCb && pathTracingCb.checked && pathTracer) {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  },
  onScreenshot: () => {
    captureNextFrame = true;
  },
});

// --- GLTF Parsing & Rendering Logic ---
function clearCurrentMesh() {
  if (activeVideoRecorder) {
    activeVideoRecorder.stop();
    activeVideoRecorder = null;
  }
  animController.clear();
  if (currentMesh) {
    scene.remove(currentMesh);
    disposeThreeObject(currentMesh);
    currentMesh = null;
  }
  updateCaptureButtonState();
}

async function rebuildSceneFromGLTF(gltfData) {
  let oldBox = null;
  if (currentMesh) {
    animController.resetToZero();
    if (pathTracingCb && pathTracingCb.checked && pathTracer) {
      syncMainEnvironmentVisibility(true);
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
    currentMesh.updateMatrixWorld(true);
    oldBox = computeModelBounds(currentMesh, currentAnimations);
  }

  clearCurrentMesh();

  const gltf = await parseGlbBuffer(gltfData);
  if (isGodotPlaying) return;

  currentMesh = gltf.scene;
  currentAnimations = gltf.animations || [];
  const isWireframe = wireframeCb ? wireframeCb.checked : false;
  const isBloom = bloomCb ? bloomCb.checked : false;
  viewerCtx.applyBloom(isBloom, isWireframe);

  const extracted = extractCamerasAndLights(currentMesh);
  gltfCameras = extracted.gltfCameras;
  gltfLights = extracted.gltfLights;
  sceneHasLights = extracted.sceneHasLights;
  currentOptimalExposure = extracted.optimalExposure || 1.0;

  const lightsCbLabel = document.getElementById("lights-cb-label");
  if (lightsCbLabel) {
    lightsCbLabel.style.display = sceneHasLights ? "flex" : "none";
  }

  const useLights = lightsCb ? lightsCb.checked : true;
  gltfLights.forEach((l) => (l.visible = useLights));
  scene.environmentIntensity = sceneHasLights && useLights ? 0.0 : 0.8;
  renderer.toneMappingExposure =
    sceneHasLights && useLights ? currentOptimalExposure : 1.0;

  const camResult = populateCameraSelect(
    cameraSelect,
    gltfCameras,
    camera,
    controls,
  );
  activeCamera = camResult.activeCamera;

  const w = viewerEl ? viewerEl.clientWidth : window.innerWidth;
  const h = viewerEl ? viewerEl.clientHeight : window.innerHeight;
  updateCameraAspect(activeCamera, w, h);
  renderPass.camera = activeCamera;

  animController.setup(currentMesh, currentAnimations, camResult.hasCameras);
  setupMeshShadowsAndWireframe(currentMesh, isWireframe);

  scene.add(currentMesh);
  currentMesh.updateMatrixWorld(true);

  let geometryChanged = true;
  let newBox = null;
  if (oldBox && !oldBox.isEmpty()) {
    newBox = computeModelBounds(currentMesh, currentAnimations);
    if (!newBox.isEmpty()) {
      const epsilon = 0.001;
      if (
        oldBox.min.distanceTo(newBox.min) < epsilon &&
        oldBox.max.distanceTo(newBox.max) < epsilon
      ) {
        geometryChanged = false;
      }
    }
  }

  if (geometryChanged) {
    fitCamera();
  } else {
    if (newBox) {
      const size = newBox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 10;
      applyDynamicBoundsToLights(currentMesh, maxDim * 1.5);
    }

    syncMainEnvironmentVisibility();
    if (pathTracer) {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  }
}

function fitCamera() {
  if (!currentMesh) return;
  const worldBox = computeModelBounds(currentMesh, currentAnimations);
  if (worldBox.isEmpty()) return;

  floor.position.y = worldBox.min.y - 0.01;
  gridHelper.position.y = floor.position.y + 0.001;
  axesHelper.position.y = floor.position.y + 0.002;

  const { maxDim } = fitCameraToBox(
    camera,
    controls,
    dirLight,
    scene,
    worldBox,
  );

  applyDynamicBoundsToLights(currentMesh, maxDim * 1.5);
  syncMainEnvironmentVisibility();

  if (pathTracer) {
    pathTracer.setScene(scene, activeCamera);
    pathTracer.updateCamera();
  }
}

// Animation loop
let lastTime = performance.now();
let animateFrameId = null;

function startScadViewerLoop() {
  if (isGodotPlaying || animateFrameId !== null) return;
  lastTime = performance.now();
  animateFrameId = requestAnimationFrame(animate);
}

function stopScadViewerLoop() {
  if (animateFrameId !== null) {
    cancelAnimationFrame(animateFrameId);
    animateFrameId = null;
  }
}

function animate() {
  if (isGodotPlaying) {
    animateFrameId = null;
    return;
  }
  animateFrameId = requestAnimationFrame(animate);
  const now = performance.now();
  const delta = (now - lastTime) / 1000;
  lastTime = now;

  const isPT = Boolean(pathTracingCb && pathTracingCb.checked);
  const isRecording = Boolean(activeVideoRecorder);
  animController.update(delta, { pausePlayback: isPT || isRecording });

  controls.update();
  syncMainEnvironmentVisibility(isPT);

  if (isPT) {
    if (pathTracer && !isRecording) {
      pathTracer.renderSample();
    }
  } else if (!isRecording) {
    composer.render();
  }

  if (captureNextFrame) {
    captureNextFrame = false;
    const dlName = getScadExportBaseName(getEditorContent());
    renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${dlName}.png`);
    }, "image/png");
  }
}

window.addEventListener("resize", () => {
  if (!viewerEl || activeVideoRecorder || isGodotPlaying) return;
  viewerCtx.resize(viewerEl.clientWidth, viewerEl.clientHeight, activeCamera);
});
setTimeout(() => window.dispatchEvent(new Event("resize")), 100);

const isLocal = ["localhost", "127.0.0.1", ""].includes(
  window.location.hostname,
);
editorEl.placeholder = "Enter OpenSCAD code here...";

window.addEventListener("hashchange", async () => {
  if (window.location.hash && window.location.hash.length > 1) {
    try {
      const hash = window.location.hash.substring(1);
      const code = await decodeCode(hash);
      if (code !== null) {
        if (hasEmbedParam()) {
          setEmbedMode(true);
        }
        await openModelInLocalStore({
          content: code,
          fallbackPrefix: "Shared Model",
          versionLabel: "Shared link",
        });
        checkChanges();
        if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
        compileAndRender(getEditorContent());
      }
    } catch (e) {
      console.error("Failed to decode hash on change", e);
    }
  } else {
    if (editorEl.value !== "") {
      await persistCurrentActiveModel("Before clear");
      isRestoringWorkspace = true;
      try {
        activeLocalModelId = DRAFT_MODEL_ID;
        modelNameInputEl.value = "";
        editorEl.value = "";
        currentEntryFile = null;
        currentEntryScadFile = null;
      } finally {
        isRestoringWorkspace = false;
      }
      await saveLocalModel({
        id: DRAFT_MODEL_ID,
        name: "",
        content: "",
        entryFile: null,
      });
      syncMdFilesUi("");
      checkChanges();
      saveWorkspaceImmediate();
      await refreshLocalModelsUi();
      await refreshVersionsUi();
      compileAndRender(getEditorContent());
    }
  }
});

(async function init() {
  if (hasEmbedParam()) {
    setEmbedMode(true);
  }

  if (isLocal) {
    const url = backendUrlEl.value.trim();
    await connectToServer(url, true);
  }

  await initLocalPersistence();

  if (window.location.hash && window.location.hash.length > 1) {
    try {
      const hash = window.location.hash.substring(1);
      const code = await decodeCode(hash);
      if (code) {
        await openModelInLocalStore({
          content: code,
          fallbackPrefix: "Shared Model",
          versionLabel: "Shared link",
        });
      }
    } catch (e) {
      console.error("Failed to decode hash", e);
    }
  } else {
    const fileUrl = getFileParam(window.location.search);
    if (fileUrl) {
      try {
        const loaded = await fetchModelFromUrl(fileUrl, window.location.href);
        if (loaded) {
          await openModelInLocalStore({
            content: loaded.content,
            name: loaded.name,
            fallbackPrefix: "URL Model",
            versionLabel: "URL model",
          });
        }
      } catch (e) {
        console.error("Failed to load model from URL", e);
        updateLocalSaveStatus("Failed to load URL model", false);
      }
    }
  }

  checkChanges();
  syncMdFilesUi(editorEl.value);

  if (isEmbedMode) {
    const godotProject = parseGodotMarkdownProject(getEditorContent());
    if (godotProject) {
      launchGodotProject(godotProject);
      return;
    }
  }

  startScadViewerLoop();
  setTimeout(() => compileAndRender(getEditorContent()), 500);
})();
