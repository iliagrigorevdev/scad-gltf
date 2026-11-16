import { generatePrompt } from "scad-gltf/prompt";
import wasmUrl from "scad-gltf/openscad.wasm?url";
import { convertScadToGltf, convertScadTo3MF } from "scad-gltf/convert";
import * as THREE from "three";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  PROMPT_UI_HTML,
  setupPromptToggles,
  buildPromptFromUI,
} from "./prompt-ui.js";
import {
  extractFilesFromMarkdown,
  extractModelNameFromScad,
  getMarkdownLangFromPath,
} from "scad-gltf/utils";
import {
  updateCameraAspect,
  computeModelBounds,
  downloadBlob,
  encodeCode,
  decodeCode,
  fetchDependencies,
  fitCameraToBox,
  setupMeshShadowsAndWireframe,
  applyDynamicBoundsToLights,
  extractCamerasAndLights,
} from "./shared.js";
import {
  parseGodotMarkdownProject,
  compileGodotProjectToPck,
  exportGodotProjectWebZip,
  exportGodotProjectZip,
} from "./godot-project.js";
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
const modelNameInputEl = document.getElementById("model-name-input");
const entryFileSelect = document.getElementById("entry-file-select");
const copyMdFileBtn = document.getElementById("copy-md-file-btn");
const pasteMdFileBtn = document.getElementById("paste-md-file-btn");
const editorEl = document.getElementById("editor");
const editorContainerEl = document.getElementById("editor-container");
const editorHighlightsEl = document.getElementById("editor-highlights");
const renderBtn = document.getElementById("render-btn");
const loadScadBtn = document.getElementById("load-scad-btn");
const downloadScadBtn = document.getElementById("download-scad-btn");
const exportGltfBtn = document.getElementById("export-gltf-btn");
const export3mfBtn = document.getElementById("export-3mf-btn");
const captureImageBtn = document.getElementById("capture-image-btn");
const shareBtn = document.getElementById("share-btn");
const autoRenderCb = document.getElementById("auto-render-cb");
const minifyShareCb = document.getElementById("minify-share-cb");

const viewerEl = document.getElementById("viewer");
const rightPanel = document.getElementById("right-panel");
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
const fullscreenBtn = document.getElementById("fullscreen-btn");
const screenshotBtn = document.getElementById("screenshot-btn");
const cameraSelect = document.getElementById("camera-select");

const playGodotBtn = document.getElementById("play-godot-btn");
const downloadGodotZipBtn = document.getElementById("download-godot-zip-btn");
const downloadGodotProjectZipBtn = document.getElementById(
  "download-godot-project-zip-btn",
);
const godotPanel = document.getElementById("godot-panel");
const godotViewport = document.getElementById("godot-viewport");
const godotStatusOverlay = document.getElementById("godot-status-overlay");
const godotRestartBtn = document.getElementById("godot-restart-btn");
const godotStopBtn = document.getElementById("godot-stop-btn");
const godotLogsBtn = document.getElementById("godot-logs-btn");
const godotScreenshotBtn = document.getElementById("godot-screenshot-btn");
const godotFullscreenBtn = document.getElementById("godot-fullscreen-btn");
const godotLogsDrawer = document.getElementById("godot-logs-drawer");
const godotLogsOutput = document.getElementById("godot-logs-output");
const godotLogsClearBtn = document.getElementById("godot-logs-clear-btn");
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
let mixer = null;
let captureNextFrame = false;

// Video Capture State
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let stopRecordingRequested = false;

// Track connection and state
let isServerConnected = false;
let currentModelOriginalState = {
  isNew: true,
  options: {},
  content: "",
};

// Animation State
let currentAction = null;
let isPlaying = true;
let isDraggingSlider = false;

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

let activeLocalModelId = DRAFT_MODEL_ID;
let localModelsList = [];
let localVersionsList = [];
let localAutoVersionTimer = null;
let lastAutoVersionAt = 0;
let isRestoringWorkspace = false;

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

function extractRootFolderFromMarkdownFiles(files) {
  const paths = Object.keys(files)
    .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter(Boolean);
  if (paths.length === 0) return null;

  let rootFolder = null;
  for (const p of paths) {
    const slashIdx = p.indexOf("/");
    if (slashIdx <= 0) return null;
    const top = p.slice(0, slashIdx);
    if (rootFolder === null) {
      rootFolder = top;
    } else if (rootFolder !== top) {
      return null;
    }
  }
  return rootFolder;
}

function formatVersionTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
function isMarkdownContent(code) {
  if (typeof code !== "string") return false;
  return (
    (code.includes("```") && code.includes("###")) ||
    /```(?:openscad|scad)?\r?\n/i.test(code)
  );
}

function parseMdFileBlocks(mdContent) {
  const blocks = [];
  if (typeof mdContent !== "string") return blocks;

  const headerMatchRegex = /^###\s+(\S+)\s*$/;
  let pos = 0;
  let currentFile = null;
  let headerStart = -1;
  let inCodeBlock = false;
  let contentStart = -1;

  while (pos <= mdContent.length) {
    const nlIdx = mdContent.indexOf("\n", pos);
    const lineEnd = nlIdx === -1 ? mdContent.length : nlIdx;
    const rawLine = mdContent.slice(pos, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    const headerMatch = line.match(headerMatchRegex);
    if (headerMatch) {
      currentFile = headerMatch[1];
      headerStart = pos;
      inCodeBlock = false;
      contentStart = -1;
    } else if (currentFile) {
      if (line.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          contentStart = nlIdx === -1 ? lineEnd : nlIdx + 1;
        } else {
          const prevChar = pos >= 2 ? mdContent[pos - 2] : "";
          const contentEnd =
            pos > contentStart
              ? prevChar === "\r"
                ? pos - 2
                : pos - 1
              : contentStart;
          blocks.push({
            filePath: currentFile,
            headerStart,
            contentStart,
            contentEnd,
            blockEnd: lineEnd,
          });
          currentFile = null;
          inCodeBlock = false;
          contentStart = -1;
        }
      }
    }

    if (nlIdx === -1) break;
    pos = nlIdx + 1;
  }

  if (blocks.length === 0) {
    const genericRegex = /```(?:openscad|scad)?\r?\n([\s\S]*?)```/i;
    const match = genericRegex.exec(mdContent);
    if (match) {
      const fullMatchStart = match.index;
      const openNl = mdContent.indexOf("\n", fullMatchStart);
      const rawStart = openNl === -1 ? fullMatchStart : openNl + 1;
      const rawEnd = fullMatchStart + match[0].length - 3;
      const bodySlice = mdContent.slice(rawStart, rawEnd);
      const trimmedBody = bodySlice.trim();
      const trimOffset = trimmedBody ? bodySlice.indexOf(trimmedBody) : 0;
      blocks.push({
        filePath: "main.scad",
        headerStart: fullMatchStart,
        contentStart: rawStart + trimOffset,
        contentEnd: rawStart + trimOffset + trimmedBody.length,
        blockEnd: fullMatchStart + match[0].length,
      });
    }
  }

  return blocks;
}

function findMdBlockAtCursor(mdContent, cursorIndex) {
  const blocks = parseMdFileBlocks(mdContent);
  for (const b of blocks) {
    if (cursorIndex >= b.headerStart && cursorIndex <= b.blockEnd) {
      return b;
    }
  }
  return null;
}

let lastHighlightedText = null;
let lastHighlightedActiveFile = null;

function isScadFilePath(filePath) {
  return (
    typeof filePath === "string" && filePath.toLowerCase().endsWith(".scad")
  );
}

function analyzeMdLines(content) {
  const lines = content.split("\n");
  const parsed = new Array(lines.length);
  const headerMatchRegex = /^###\s+(\S+)\s*$/;

  let currentFile = null;
  let inCodeBlock = false;
  let genericInCodeBlock = false;
  let genericFilePath = null;
  let genericIsScad = false;
  let blockIdx = -1;
  let hasFileBlocks = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(headerMatchRegex);

    if (headerMatch) {
      blockIdx++;
      currentFile = headerMatch[1];
      inCodeBlock = false;
      genericInCodeBlock = false;
      genericFilePath = null;
      genericIsScad = false;
      hasFileBlocks = true;
      parsed[i] = {
        line,
        role: "header",
        blockIdx,
        filePath: currentFile,
        isScad: isScadFilePath(currentFile),
      };
      continue;
    }

    if (currentFile !== null) {
      const isScad = isScadFilePath(currentFile);
      if (line.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          parsed[i] = {
            line,
            role: "fence-open",
            blockIdx,
            filePath: currentFile,
            isScad,
          };
        } else {
          parsed[i] = {
            line,
            role: "fence-close",
            blockIdx,
            filePath: currentFile,
            isScad,
          };
          inCodeBlock = false;
          currentFile = null;
        }
      } else if (inCodeBlock) {
        parsed[i] = {
          line,
          role: "body",
          blockIdx,
          filePath: currentFile,
          isScad,
        };
      } else {
        parsed[i] = {
          line,
          role: "preamble",
          blockIdx,
          filePath: currentFile,
          isScad,
        };
      }
      continue;
    }

    if (line.startsWith("```")) {
      if (!genericInCodeBlock) {
        const fenceLang = line.slice(3).trim().toLowerCase();
        genericIsScad =
          fenceLang === "" || fenceLang === "openscad" || fenceLang === "scad";
        genericFilePath = genericIsScad ? "main.scad" : null;
        blockIdx++;
        genericInCodeBlock = true;
        hasFileBlocks = true;
        parsed[i] = {
          line,
          role: "fence-open",
          blockIdx,
          filePath: genericFilePath,
          isScad: genericIsScad,
        };
      } else {
        parsed[i] = {
          line,
          role: "fence-close",
          blockIdx,
          filePath: genericFilePath,
          isScad: genericIsScad,
        };
        genericInCodeBlock = false;
        genericFilePath = null;
        genericIsScad = false;
      }
      continue;
    }

    if (genericInCodeBlock) {
      parsed[i] = {
        line,
        role: "body",
        blockIdx,
        filePath: genericFilePath,
        isScad: genericIsScad,
      };
      continue;
    }

    parsed[i] = {
      line,
      role: "plain",
      blockIdx: -1,
      filePath: null,
      isScad: false,
    };
  }

  return { parsed, hasFileBlocks };
}

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
  const block = blocks.find((b) => b.filePath === filePath);
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

function updateEntryFileSelectStyle(filePath) {
  if (!entryFileSelect) return;
  entryFileSelect.classList.toggle("is-scad-file", isScadFilePath(filePath));
}

function syncMdFilesUi(code) {
  const ctx = getMdFilesContext(code);
  if (ctx.isMd && ctx.allFiles.length > 0) {
    const allFiles = ctx.allFiles;
    const scadFiles = allFiles.filter((f) => isScadFilePath(f));
    const otherFiles = allFiles.filter((f) => !isScadFilePath(f));

    entryFileSelect.style.display = "flex";
    if (copyMdFileBtn) copyMdFileBtn.style.display = "flex";
    if (pasteMdFileBtn) pasteMdFileBtn.style.display = "flex";

    const orderedFiles = [...scadFiles, ...otherFiles];
    const currentOptions = Array.from(entryFileSelect.options)
      .map((o) => o.value)
      .join(",");
    const newOptions = orderedFiles.join(",");
    if (currentOptions !== newOptions) {
      entryFileSelect.innerHTML = "";

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

    if (!allFiles.includes(currentEntryFile)) {
      currentEntryFile = scadFiles[0] || allFiles[0];
    }
    if (!scadFiles.includes(currentEntryScadFile)) {
      currentEntryScadFile = scadFiles.includes(currentEntryFile)
        ? currentEntryFile
        : scadFiles[0] || null;
    }
    entryFileSelect.value = currentEntryFile;
    updateEntryFileSelectStyle(currentEntryFile);
  } else {
    entryFileSelect.style.display = "none";
    updateEntryFileSelectStyle(null);
    if (copyMdFileBtn) copyMdFileBtn.style.display = "none";
    if (pasteMdFileBtn) pasteMdFileBtn.style.display = "none";
    currentEntryFile = null;
    currentEntryScadFile = null;
  }
  if (playGodotBtn) {
    playGodotBtn.style.display = ctx.isGodot ? "flex" : "none";
  }
  if (downloadGodotZipBtn) {
    downloadGodotZipBtn.style.display = ctx.isGodot ? "flex" : "none";
  }
  if (downloadGodotProjectZipBtn) {
    downloadGodotProjectZipBtn.style.display = ctx.isGodot ? "flex" : "none";
  }
  updateEditorHighlights();
  return ctx;
}

function replaceFileInMarkdown(mdContent, targetPath, newFileContent) {
  const normalizedMd = String(mdContent ?? "").replace(/\r\n/g, "\n");
  const normalizedNew = String(newFileContent ?? "").replace(/\r\n/g, "\n");
  const lines = normalizedMd.split("\n");
  const headerMatchRegex = /^###\s+(\S+)\s*$/;

  let currentFile = null;
  let inCodeBlock = false;
  let openFenceIdx = -1;
  let closeFenceIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(headerMatchRegex);
    if (headerMatch) {
      currentFile = headerMatch[1];
      inCodeBlock = false;
      continue;
    }

    if (currentFile === targetPath) {
      if (line.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          openFenceIdx = i;
        } else {
          closeFenceIdx = i;
          break;
        }
      }
    } else if (currentFile !== null) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          currentFile = null;
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
      }
    }
  }

  if (openFenceIdx !== -1 && closeFenceIdx !== -1) {
    const replacementLines =
      normalizedNew === "" ? [] : normalizedNew.split("\n");
    const updatedLines = [
      ...lines.slice(0, openFenceIdx + 1),
      ...replacementLines,
      ...lines.slice(closeFenceIdx),
    ];
    return updatedLines.join("\n");
  }

  if (targetPath === "main.scad") {
    const genericRegex = /(```(?:openscad|scad)?\n)([\s\S]*?)(```)/i;
    if (genericRegex.test(normalizedMd)) {
      const body = normalizedNew === "" ? "" : `${normalizedNew}\n`;
      return normalizedMd.replace(genericRegex, `$1${body}$3`);
    }
  }

  const lang = getMarkdownLangFromPath(targetPath);
  const sep = normalizedMd.endsWith("\n") ? "\n" : "\n\n";
  return `${normalizedMd}${normalizedMd ? sep : ""}### ${targetPath}\n\`\`\`${lang}\n${normalizedNew}\n\`\`\`\n`;
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
    updateEditorHighlights();
  }

  if (
    block.filePath.toLowerCase().endsWith(".scad") &&
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
  scrollEditorToMdFile(selectedFile);
  updateEditorHighlights();
  saveWorkspaceImmediate();

  if (selectedFile.toLowerCase().endsWith(".scad")) {
    currentEntryScadFile = selectedFile;
    if (!isGodotPlaying) {
      compileAndRender(getEditorContent());
    }
  }
});

editorEl.addEventListener("scroll", syncEditorBackdropScroll);
editorEl.addEventListener("mouseup", handleEditorCursorChange);
editorEl.addEventListener("keyup", handleEditorCursorChange);

if (copyMdFileBtn) {
  copyMdFileBtn.addEventListener("click", async () => {
    const targetFile = entryFileSelect.value || currentEntryFile;
    if (!targetFile) return;

    const ctx = getMdFilesContext(editorEl.value);
    const fileContent = ctx.filesMap[targetFile];
    if (fileContent === undefined) return;

    try {
      await navigator.clipboard.writeText(fileContent);
      const originalText = copyMdFileBtn.innerText;
      copyMdFileBtn.innerText = "✅ Copied!";
      setTimeout(() => {
        copyMdFileBtn.innerText = originalText;
      }, 1500);
    } catch (err) {
      alert("Failed to copy to clipboard: " + err);
    }
  });
}

if (pasteMdFileBtn) {
  pasteMdFileBtn.addEventListener("click", async () => {
    const targetFile = entryFileSelect.value || currentEntryFile;
    if (!targetFile) return;

    try {
      const text = await navigator.clipboard.readText();
      const normalizedClipboard = text.replace(/\r\n/g, "\n");
      const isPastedMd =
        /^###\s+\S+\s*$/m.test(normalizedClipboard) &&
        normalizedClipboard.includes("```");
      const pastedFiles = isPastedMd
        ? extractFilesFromMarkdown(normalizedClipboard)
        : {};
      const pastedEntries = Object.entries(pastedFiles);

      let updatedMd = editorEl.value;
      const patchedFiles = [];

      if (pastedEntries.length > 0) {
        for (const [filePath, fileContent] of pastedEntries) {
          updatedMd = replaceFileInMarkdown(updatedMd, filePath, fileContent);
          patchedFiles.push(filePath);
        }
      } else {
        updatedMd = replaceFileInMarkdown(updatedMd, targetFile, text);
        patchedFiles.push(targetFile);
      }

      await maybeCreateAutoVersion("Before paste", true);
      editorEl.value = updatedMd;
      syncMdFilesUi(updatedMd);
      checkChanges();
      saveWorkspaceImmediate();

      const focusFile = patchedFiles.includes(targetFile)
        ? targetFile
        : patchedFiles[0];
      const updatedBlock = parseMdFileBlocks(updatedMd).find(
        (b) => b.filePath === focusFile,
      );
      if (updatedBlock) {
        editorEl.setSelectionRange(
          updatedBlock.contentStart,
          updatedBlock.contentStart,
        );
      }

      const hasScadChange = patchedFiles.some((f) =>
        f.toLowerCase().endsWith(".scad"),
      );
      if (hasScadChange && autoRenderCb.checked && !isGodotPlaying) {
        compileAndRender(getEditorContent());
      }

      const originalText = pasteMdFileBtn.innerText;
      pasteMdFileBtn.innerText = "✅ Pasted!";
      setTimeout(() => {
        pasteMdFileBtn.innerText = originalText;
      }, 1500);
    } catch (err) {
      alert(
        "Failed to read clipboard: " +
          (err?.message ||
            "Permission denied. Use Ctrl+V / Cmd+V directly in the editor."),
      );
    }
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
    if (downloadGodotProjectZipBtn) {
      downloadGodotProjectZipBtn.style.display = "flex";
    }

    applyDerivedModelName(
      `${godotProject.projectName}.md`,
      pendingForceNameOverride,
    );
    pendingForceNameOverride = false;

    if (isGodotPlaying) {
      return;
    }
  } else {
    isGodotProject = false;
    if (playGodotBtn) playGodotBtn.style.display = "none";
    if (downloadGodotZipBtn) downloadGodotZipBtn.style.display = "none";
    if (downloadGodotProjectZipBtn)
      downloadGodotProjectZipBtn.style.display = "none";
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
    const scadFiles = Object.keys(files).filter((f) =>
      f.toLowerCase().endsWith(".scad"),
    );

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
        const text = await e.target.files[0].text();
        await maybeCreateAutoVersion("Before file load", true);
        editorEl.value = text;
        if (backendSelectEl.value === "") {
          pendingForceNameOverride = true;
        }
        checkChanges();
        saveWorkspaceImmediate();
        if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
        compileAndRender(text);
      } catch (err) {
        alert("Failed to read file: " + err.message);
      }
    }
  };
  input.click();
};

downloadScadBtn.onclick = () => {
  const codeToSave = getEditorContent();
  let dlName = getDownloadName();
  if (
    !dlName.toLowerCase().endsWith(".scad") &&
    !dlName.toLowerCase().endsWith(".md")
  ) {
    dlName +=
      codeToSave.includes("```") && codeToSave.includes("###")
        ? ".md"
        : ".scad";
  }
  downloadBlob(new Blob([codeToSave], { type: "text/plain" }), dlName);
};

exportGltfBtn.onclick = () => {
  if (!currentGltfData) return;
  let dlName = getDownloadName();
  if (dlName.toLowerCase().endsWith(".md")) {
    dlName = dlName.substring(0, dlName.length - 3);
  }
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

  const isMd =
    (scadCode.includes("```") && scadCode.includes("###")) ||
    /```(?:openscad|scad)?\r?\n/i.test(scadCode);

  if (isMd) {
    const files = extractFilesFromMarkdown(scadCode);
    const scadFiles = Object.keys(files).filter((f) =>
      f.toLowerCase().endsWith(".scad"),
    );
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
    let dlName = getDownloadName();

    if (dlName.toLowerCase().endsWith(".md")) {
      dlName = dlName.substring(0, dlName.length - 3);
    } else if (dlName.toLowerCase().endsWith(".scad")) {
      dlName = dlName.substring(0, dlName.length - 5);
    }

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
  if (isRecording) {
    captureImageBtn.innerText = "🔴 Rec...";
  } else if (currentAction && isPlaying) {
    captureImageBtn.innerText = "🎥 Video";
  } else {
    captureImageBtn.innerText = "📷 Image";
  }
}

captureImageBtn.onclick = () => {
  if (isRecording) {
    stopRecordingRequested = true;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    return;
  }

  if (currentAction && isPlaying) {
    if (typeof MediaRecorder !== "undefined") {
      const isPT =
        typeof pathTracer !== "undefined" &&
        pathTracingCb &&
        pathTracingCb.checked;

      // Reset animation to the beginning
      currentAction.time = 0;
      if (mixer) mixer.update(0);

      // Fixed 512x512 canvas for recording
      const targetW = 512;
      const targetH = 512;

      // Force WebGL render at exact target resolution to prevent stretching
      updateCameraAspect(activeCamera, targetW, targetH);
      renderer.setSize(targetW, targetH, false);
      composer.setSize(targetW, targetH);
      if (isPT) {
        pathTracer.updateCamera();
      }

      const srcCanvas = renderer.domElement;

      const recordCanvas = document.createElement("canvas");
      recordCanvas.width = targetW;
      recordCanvas.height = targetH;
      const recordCtx = recordCanvas.getContext("2d");

      const stream = recordCanvas.captureStream(30);

      // Limit Bitrate for optimal file sizes
      const targetBitrate = 2_500_000; // 2.5 Mbps

      let extension = "mp4";
      let options = {
        mimeType: "video/mp4;codecs=avc1",
        videoBitsPerSecond: targetBitrate,
      };

      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = {
          mimeType: "video/mp4",
          videoBitsPerSecond: targetBitrate,
        };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          extension = "webm";
          options = {
            mimeType: "video/webm;codecs=vp9",
            videoBitsPerSecond: targetBitrate,
          };
          if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = {
              mimeType: "video/webm;codecs=vp8",
              videoBitsPerSecond: targetBitrate,
            };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
              options = {
                mimeType: "video/webm",
                videoBitsPerSecond: targetBitrate,
              };
            }
          }
        }
      }

      let drawInterval = null;
      stopRecordingRequested = false;

      isRecording = true;
      updateCaptureButtonState();

      const ptSamplesTarget = 100; // Increased for better quality and stability
      const fps = 30;
      const duration = currentAction.getClip().duration;
      const totalFrames = Math.round(duration * fps);
      let currentFrame = 0;
      const renderedFrames = [];

      const renderNextFrame = () => {
        if (stopRecordingRequested || currentFrame >= totalFrames) {
          if (renderedFrames.length === 0) {
            isRecording = false;
            updateCameraAspect(
              activeCamera,
              viewerEl.clientWidth,
              viewerEl.clientHeight,
            );
            renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
            composer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
            if (isPT && typeof pathTracer !== "undefined") {
              pathTracer.setScene(scene, activeCamera);
              pathTracer.updateCamera();
            }
            updateCaptureButtonState();
            return;
          }

          stopRecordingRequested = false;

          mediaRecorder = new MediaRecorder(stream, options);
          recordedChunks = [];

          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
          };

          mediaRecorder.onstop = () => {
            if (drawInterval) clearTimeout(drawInterval);
            const blob = new Blob(recordedChunks, {
              type: options.mimeType.split(";")[0],
            });
            let dlName = getDownloadName();
            if (dlName.toLowerCase().endsWith(".md")) {
              dlName = dlName.substring(0, dlName.length - 3);
            }
            downloadBlob(blob, `${dlName}.${extension}`);
            isRecording = false;

            updateCameraAspect(
              activeCamera,
              viewerEl.clientWidth,
              viewerEl.clientHeight,
            );
            renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
            composer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
            if (isPT && typeof pathTracer !== "undefined") {
              pathTracer.setScene(scene, activeCamera);
              pathTracer.updateCamera();
            }
            updateCaptureButtonState();
          };

          recordCtx.drawImage(renderedFrames[0], 0, 0, targetW, targetH);
          mediaRecorder.start();

          let frameIndex = 0;
          let startTime = performance.now();

          const playLoop = () => {
            if (stopRecordingRequested) {
              mediaRecorder.stop();
              return;
            }

            if (frameIndex < renderedFrames.length) {
              recordCtx.drawImage(
                renderedFrames[frameIndex],
                0,
                0,
                targetW,
                targetH,
              );
              frameIndex++;

              // Calculate exactly when the next frame should be drawn
              const nextTime = startTime + frameIndex * (1000 / fps);
              const delay = Math.max(0, nextTime - performance.now());
              drawInterval = setTimeout(playLoop, delay);
            } else {
              // Wait briefly to ensure MediaRecorder catches the final frame
              drawInterval = setTimeout(() => mediaRecorder.stop(), 50);
            }
          };

          drawInterval = setTimeout(playLoop, 0);
          return;
        }

        currentAction.time = currentFrame / fps;
        if (mixer) {
          mixer.update(0);
        }

        if (isPT) {
          if (typeof floor !== "undefined") floor.visible = false;
          if (typeof lightGroup !== "undefined") lightGroup.visible = false;
          if (typeof gridHelper !== "undefined") gridHelper.visible = false;
          if (typeof axesHelper !== "undefined") axesHelper.visible = false;
          pathTracer.setScene(scene, activeCamera);

          const waitForSamples = () => {
            if (stopRecordingRequested) {
              renderNextFrame(); // break loop and proceed to encode what we have
              return;
            }

            // Advance the path tracer deterministically instead of via animate()
            let samplesThisFrame = 0;
            const maxSamplesPerFrame = 5; // Keeps UI somewhat responsive
            while (
              pathTracer.samples < ptSamplesTarget &&
              samplesThisFrame < maxSamplesPerFrame
            ) {
              pathTracer.renderSample();
              samplesThisFrame++;
            }

            if (pathTracer.samples >= ptSamplesTarget) {
              const frameCanvas = document.createElement("canvas");
              frameCanvas.width = targetW;
              frameCanvas.height = targetH;
              frameCanvas
                .getContext("2d")
                .drawImage(srcCanvas, 0, 0, targetW, targetH);
              renderedFrames.push(frameCanvas);

              currentFrame++;
              setTimeout(renderNextFrame, 0);
            } else {
              requestAnimationFrame(waitForSamples);
            }
          };
          waitForSamples();
        } else {
          const showGrid = showGridCb ? showGridCb.checked : true;
          if (typeof floor !== "undefined") floor.visible = true;
          if (typeof lightGroup !== "undefined")
            lightGroup.visible =
              !sceneHasLights || (lightsCb && !lightsCb.checked);
          if (typeof gridHelper !== "undefined") gridHelper.visible = showGrid;
          if (typeof axesHelper !== "undefined") axesHelper.visible = showGrid;

          composer.render();

          const frameCanvas = document.createElement("canvas");
          frameCanvas.width = targetW;
          frameCanvas.height = targetH;
          frameCanvas
            .getContext("2d")
            .drawImage(srcCanvas, 0, 0, targetW, targetH);
          renderedFrames.push(frameCanvas);

          currentFrame++;
          setTimeout(renderNextFrame, 0);
        }
      };

      renderNextFrame();
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

  try {
    let mainCode = editorEl.value.trim();
    const url = new URL(window.location.href);
    let finalUrl = "";

    if (!mainCode) {
      finalUrl = url.origin + url.pathname + url.search;
    } else {
      // 1. Minifier helper (strips comments and whitespace safely)
      const minifyScad = (codeStr) => {
        let minified = "";
        let inString = false;
        let i = 0;
        while (i < codeStr.length) {
          if (inString) {
            minified += codeStr[i];
            if (codeStr[i] === '"' && codeStr[i - 1] !== "\\") inString = false;
            i++;
          } else {
            if (codeStr[i] === '"') {
              inString = true;
              minified += codeStr[i];
              i++;
            } else if (codeStr[i] === "/" && codeStr[i + 1] === "/") {
              i += 2;
              while (i < codeStr.length && codeStr[i] !== "\n") i++;
            } else if (codeStr[i] === "/" && codeStr[i + 1] === "*") {
              i += 2;
              while (
                i < codeStr.length &&
                !(codeStr[i] === "*" && codeStr[i + 1] === "/")
              )
                i++;
              i += 2;
            } else if (/\s/.test(codeStr[i])) {
              if (
                minified.length > 0 &&
                !/\s/.test(minified[minified.length - 1])
              ) {
                minified += " ";
              }
              i++;
            } else {
              minified += codeStr[i];
              i++;
            }
          }
        }
        return minified.trim();
      };

      // 2. Parse current editor content to see if it's already a bundle
      let filesToShare = {};
      const isMd = mainCode.includes("```") && mainCode.includes("###");

      if (isMd) {
        filesToShare = extractFilesFromMarkdown(mainCode);
      } else {
        let mainName = modelNameInputEl.value.trim() || "main.scad";
        if (
          !mainName.toLowerCase().endsWith(".scad") &&
          !mainName.toLowerCase().endsWith(".md")
        ) {
          mainName += ".scad";
        }
        filesToShare[mainName] = mainCode;
      }

      // 3. Auto-fetch all dependencies automatically (if connected to local backend)
      let allCode = Object.values(filesToShare).join("\n");
      const additionalFiles = await fetchDependenciesWrapper(allCode);

      // Merge fetched files into our sharing bundle
      for (const [depPath, depContent] of Object.entries(additionalFiles)) {
        if (!filesToShare[depPath]) {
          filesToShare[depPath] = depContent;
        }
      }

      // 4. Build the final string to encode
      let finalCodeToEncode = "";
      const fileNames = Object.keys(filesToShare);
      const shouldBundle = fileNames.length > 1;

      if (shouldBundle) {
        // EXPLICIT SORTING LOGIC: Guarantee the primary file is at the top
        let primaryFile = currentEntryScadFile || currentEntryFile;

        // If currentEntryFile isn't set, try to use the input name
        if (!primaryFile) {
          primaryFile = modelNameInputEl.value.trim();
          if (
            primaryFile &&
            !primaryFile.toLowerCase().endsWith(".scad") &&
            !primaryFile.toLowerCase().endsWith(".md")
          ) {
            primaryFile += ".scad";
          }
        }

        // Fallback to the first file found if it doesn't match
        if (!primaryFile || !filesToShare[primaryFile]) {
          primaryFile = fileNames[0];
        }

        // Create a sorted array with the primary file first
        const sortedFileNames = [
          primaryFile,
          ...fileNames.filter((f) => f !== primaryFile),
        ];

        // Build Markdown project bundle in exact order
        for (const fName of sortedFileNames) {
          let processedContent = filesToShare[fName];
          const lang = getMarkdownLangFromPath(fName);
          if (lang === "openscad" && minifyShareCb && minifyShareCb.checked) {
            processedContent = minifyScad(processedContent);
          }
          finalCodeToEncode += `### ${fName}\n\`\`\`${lang}\n${processedContent}\n\`\`\`\n\n`;
        }
      } else {
        // Just a single pure SCAD file
        finalCodeToEncode = filesToShare[fileNames[0]];
        if (minifyShareCb && minifyShareCb.checked) {
          finalCodeToEncode = minifyScad(finalCodeToEncode);
        }
      }

      // 5. Compress and apply hash to URL
      const hash = await encodeCode(finalCodeToEncode);
      url.hash = hash;
      finalUrl = url.toString();
    }

    // Update History visually
    window.history.replaceState(null, "", finalUrl);

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
        await navigator.clipboard.writeText(window.location.href);
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
  if (godotPanel) godotPanel.style.display = "none";
  setScadViewerUiVisible(true);
  if (playGodotBtn) playGodotBtn.innerText = "🎮 Play Godot";
  startScadViewerLoop();
  window.dispatchEvent(new Event("resize"));
  if (!skipCompile && !currentMesh) {
    const content = getEditorContent();
    const project = parseGodotMarkdownProject(content);
    const hasScad =
      !project ||
      Object.keys(project.files).some((f) => f.toLowerCase().endsWith(".scad"));
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
if (downloadGodotProjectZipBtn) {
  downloadGodotProjectZipBtn.onclick = async () => {
    const project = parseGodotMarkdownProject(getEditorContent());
    if (!project) return;

    const originalText = downloadGodotProjectZipBtn.innerText;
    downloadGodotProjectZipBtn.disabled = true;
    downloadGodotProjectZipBtn.innerText = "⏳ Zipping...";

    try {
      let dlName = getDownloadName().replace(/\.(md|scad)$/i, "");
      if (!dlName || dlName === "model") {
        dlName = project.projectName || "godot_project";
      }

      const { zipBlob, rootFolderName } = await exportGodotProjectZip(project, {
        folderName: dlName,
        onProgress: (msg) => {
          const pct = msg.match(/(\d+%)/);
          if (pct) {
            downloadGodotProjectZipBtn.innerText = `⏳ Zip ${pct[1]}`;
          }
        },
      });

      downloadBlob(zipBlob, `${rootFolderName}.zip`);
    } catch (err) {
      console.error(err);
      alert("Failed to export Godot project ZIP: " + (err?.message || err));
    } finally {
      downloadGodotProjectZipBtn.innerText = originalText;
      downloadGodotProjectZipBtn.disabled = false;
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
if (godotFullscreenBtn && rightPanel) {
  godotFullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) {
      rightPanel.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };
}

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
      new HDRLoader().load(
        url,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          scene.environment = texture;
          environmentTexture = texture;

          const isPT = pathTracingCb && pathTracingCb.checked;

          if (isPT) {
            scene.background = texture;
            scene.backgroundBlurriness = 0.5;
            scene.backgroundIntensity = 0.3;
          } else {
            scene.background = new THREE.Color(0x222222);
            scene.backgroundBlurriness = 0;
            scene.backgroundIntensity = 1.0;
          }

          if (typeof pathTracer !== "undefined") {
            pathTracer.setScene(scene, activeCamera);
            pathTracer.updateCamera();
          }
        },
        undefined,
        (err) => {
          console.warn("Error loading HDR:", err);
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
        await maybeCreateAutoVersion("Before drop", true);
        editorEl.value = text;
        if (backendSelectEl.value === "") {
          pendingForceNameOverride = true;
        }
        checkChanges();
        saveWorkspaceImmediate();
        if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
        compileAndRender(text);
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
    modelNameInputEl.value = "";
    editorEl.value = "";
    compileAndRender(getEditorContent());

    currentModelOriginalState = {
      isNew: true,
      content: "",
    };
    checkChanges();
  } else {
    const filename = serverFiles[idx];
    modelNameInputEl.value = filename;

    try {
      const res = await fetch(
        `${currentBackendUrl}/api/scads/${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to load model");
      }
      const data = await res.json();
      editorEl.value = data.content;
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
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(
  60,
  viewerEl.clientWidth / viewerEl.clientHeight,
  0.1,
  2000,
);
camera.position.set(50, 50, -50);
activeCamera = camera;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewerEl.appendChild(renderer.domElement);

// --- Post-processing: Bloom for Emissive Glow ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, activeCamera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(viewerEl.clientWidth, viewerEl.clientHeight),
  0.1, // strength
  0.1, // radius
  2.0, // threshold
);
bloomPass.enabled = false;
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

const pathTracer = new WebGLPathTracer(renderer);
pathTracer.bounces = 10;
pathTracer.transmissiveBounces = 10;
pathTracer.multipleImportanceSampling = true;
pathTracer.filterGlossyFactor = 0.2;

const controls = new OrbitControls(camera, renderer.domElement);
controls.addEventListener("change", () => {
  if (typeof pathTracer !== "undefined") pathTracer.updateCamera();
});

let environmentTexture = null;

new HDRLoader().load(
  "./aristea_wreck_puresky_2k.hdr",
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    environmentTexture = texture;

    if (isGodotPlaying) return;

    const isPT = pathTracingCb && pathTracingCb.checked;
    const showGrid = showGridCb ? showGridCb.checked : true;
    if (typeof floor !== "undefined") floor.visible = !isPT;
    if (typeof lightGroup !== "undefined")
      lightGroup.visible =
        !isPT && (!sceneHasLights || (lightsCb && !lightsCb.checked));
    if (typeof gridHelper !== "undefined")
      gridHelper.visible = !isPT && showGrid;
    if (typeof axesHelper !== "undefined")
      axesHelper.visible = !isPT && showGrid;

    if (isPT) {
      scene.background = texture;
      scene.backgroundBlurriness = 0.5;
      scene.backgroundIntensity = 0.3;
    } else {
      scene.background = new THREE.Color(0x222222);
      scene.backgroundBlurriness = 0;
      scene.backgroundIntensity = 1.0;
    }

    if (typeof pathTracer !== "undefined") {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  },
  undefined,
  (err) => console.warn("Error loading HDR:", err),
);

const pathTracingCb = document.getElementById("path-tracing-cb");
if (pathTracingCb) {
  pathTracingCb.addEventListener("change", () => {
    const isPT = pathTracingCb.checked;
    const showGrid = showGridCb ? showGridCb.checked : true;

    if (typeof floor !== "undefined") floor.visible = !isPT;
    if (typeof lightGroup !== "undefined")
      lightGroup.visible =
        !isPT && (!sceneHasLights || (lightsCb && !lightsCb.checked));
    if (typeof gridHelper !== "undefined")
      gridHelper.visible = !isPT && showGrid;
    if (typeof axesHelper !== "undefined")
      axesHelper.visible = !isPT && showGrid;

    if (isPT) {
      if (environmentTexture) {
        scene.background = environmentTexture;
        scene.backgroundBlurriness = 0.5;
        scene.backgroundIntensity = 0.3;
      }
    } else {
      scene.background = new THREE.Color(0x222222);
      scene.backgroundBlurriness = 0;
      scene.backgroundIntensity = 1.0;
    }

    if (isPT && typeof pathTracer !== "undefined") {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  });
}

if (cameraSelect) {
  cameraSelect.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "") {
      activeCamera = camera;
      controls.enabled = true;
    } else {
      activeCamera = gltfCameras[parseInt(val)];
      controls.enabled = false;
    }
    const w = viewerEl.clientWidth;
    const h = viewerEl.clientHeight;
    updateCameraAspect(activeCamera, w, h);
    renderPass.camera = activeCamera;

    if (
      pathTracingCb &&
      pathTracingCb.checked &&
      typeof pathTracer !== "undefined"
    ) {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  });
}

controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxDistance = 2000;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(
  new RoomEnvironment(),
  0.04,
).texture;
scene.environmentIntensity = 0.8;

const lightGroup = new THREE.Group();
scene.add(lightGroup);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0005;
lightGroup.add(dirLight);
lightGroup.add(dirLight.target);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemiLight.position.set(0, 20, 0);
lightGroup.add(hemiLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.8,
    metalness: 0.1,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const gridHelper = new THREE.GridHelper(2000, 100, 0x555555, 0x333333);
gridHelper.material.transparent = true;
gridHelper.material.opacity = 0.5;
scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(100);
scene.add(axesHelper);

// --- Viewer Toggles Logic ---
if (wireframeCb) {
  wireframeCb.addEventListener("change", () => {
    const isWireframe = wireframeCb.checked;
    const isBloom = bloomCb ? bloomCb.checked : false;
    bloomPass.enabled = isBloom && !isWireframe;
    if (currentMesh) {
      setupMeshShadowsAndWireframe(currentMesh, isWireframe);
    }
  });
}

if (bloomCb) {
  bloomCb.addEventListener("change", () => {
    const isBloom = bloomCb.checked;
    const isWireframe = wireframeCb ? wireframeCb.checked : false;
    bloomPass.enabled = isBloom && !isWireframe;
  });
}

if (lightsCb) {
  lightsCb.addEventListener("change", () => {
    const isPT = pathTracingCb && pathTracingCb.checked;
    const useLights = lightsCb.checked;

    gltfLights.forEach((l) => (l.visible = useLights));
    scene.environmentIntensity = sceneHasLights && useLights ? 0.0 : 0.8;
    renderer.toneMappingExposure =
      sceneHasLights && useLights ? currentOptimalExposure : 1.0;

    if (typeof lightGroup !== "undefined") {
      lightGroup.visible = !isPT && (!sceneHasLights || !useLights);
    }

    if (isPT && typeof pathTracer !== "undefined") {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  });
}

if (fullscreenBtn && rightPanel) {
  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      rightPanel.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  });

  document.addEventListener("fullscreenchange", () => {
    // Trigger resize after a tiny delay to ensure proper canvas layout
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  });
}

if (screenshotBtn) {
  screenshotBtn.addEventListener("click", () => {
    captureNextFrame = true;

    // Provide brief visual feedback on the button
    const originalText = screenshotBtn.innerText;
    screenshotBtn.innerText = "✅";
    setTimeout(() => {
      screenshotBtn.innerText = originalText;
    }, 1000);
  });
}

// --- Animation Controls ---
function updateAnimTimelineVisibility() {
  const hasAnims = currentAnimations.length > 0;
  const showTimeline =
    hasAnims && Boolean(animTimelineCb && animTimelineCb.checked);

  if (animTimelineLabel) {
    animTimelineLabel.style.display = hasAnims ? "flex" : "none";
  }
  if (animSliderRow) {
    animSliderRow.style.display = showTimeline ? "" : "none";
  }
  if (showTimeline && currentAction && animSlider) {
    const duration = currentAction.getClip().duration;
    if (duration > 0) {
      let currentClipTime = currentAction.time % duration;
      if (currentClipTime < 0) currentClipTime += duration;
      animSlider.value = currentClipTime / duration;
    } else {
      animSlider.value = 0;
    }
  }
}

if (animTimelineCb) {
  animTimelineCb.addEventListener("change", updateAnimTimelineVisibility);
}

function pauseAnimation() {
  if (!currentAction) return;
  isPlaying = false;
  currentAction.paused = true;
  animPlayBtn.innerText = "▶ Play";
  updateCaptureButtonState();
}

function playAnimation(index) {
  if (!mixer || !currentAnimations[index]) return;
  if (currentAction) {
    currentAction.stop();
  }
  const clip = currentAnimations[index];
  currentAction = mixer.clipAction(clip);
  currentAction.play();
  currentAction.time = 0;
  mixer.update(0);
  isPlaying = true;
  currentAction.paused = false;
  animPlayBtn.innerText = "⏸ Pause";
  animSlider.value = 0;
  updateCaptureButtonState();
}

animSelect.addEventListener("change", (e) => {
  playAnimation(parseInt(e.target.value));
});

animPlayBtn.addEventListener("click", () => {
  if (!currentAction) return;
  isPlaying = !isPlaying;
  currentAction.paused = !isPlaying;
  animPlayBtn.innerText = isPlaying ? "⏸ Pause" : "▶ Play";
  updateCaptureButtonState();
});

animSlider.addEventListener("mousedown", () => {
  isDraggingSlider = true;
  pauseAnimation();
});
animSlider.addEventListener("mouseup", () => {
  isDraggingSlider = false;
});
animSlider.addEventListener(
  "touchstart",
  () => {
    isDraggingSlider = true;
    pauseAnimation();
  },
  { passive: true },
);
animSlider.addEventListener(
  "touchend",
  () => {
    isDraggingSlider = false;
  },
  { passive: true },
);

animSlider.addEventListener("input", (e) => {
  pauseAnimation();
  if (currentAction) {
    const duration = currentAction.getClip().duration;
    currentAction.time = parseFloat(e.target.value) * duration;
    if (mixer) {
      mixer.update(0);
      if (
        pathTracingCb &&
        pathTracingCb.checked &&
        typeof pathTracer !== "undefined"
      ) {
        if (typeof floor !== "undefined") floor.visible = false;
        if (typeof lightGroup !== "undefined") lightGroup.visible = false;
        if (typeof gridHelper !== "undefined") gridHelper.visible = false;
        if (typeof axesHelper !== "undefined") axesHelper.visible = false;
        pathTracer.setScene(scene, activeCamera);
        pathTracer.updateCamera();
      }
    }
  }
});

// --- GLTF Parsing & Rendering Logic ---
function clearCurrentMesh() {
  if (isRecording && mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    isRecording = false;
  }
  if (currentMesh) {
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
      mixer = null;
    }
    currentAction = null;
    scene.remove(currentMesh);
    currentMesh.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
    currentMesh = null;
  }
  updateCaptureButtonState();
}

function rebuildSceneFromGLTF(gltfData) {
  return new Promise((resolve, reject) => {
    let oldBox = null;
    if (currentMesh) {
      if (mixer && currentAction) {
        currentAction.time = 0;
        mixer.update(0);
        if (
          pathTracingCb &&
          pathTracingCb.checked &&
          typeof pathTracer !== "undefined"
        ) {
          if (typeof floor !== "undefined") floor.visible = false;
          if (typeof lightGroup !== "undefined") lightGroup.visible = false;
          if (typeof gridHelper !== "undefined") gridHelper.visible = false;
          if (typeof axesHelper !== "undefined") axesHelper.visible = false;
          pathTracer.setScene(scene, activeCamera);
          pathTracer.updateCamera();
        }
      }
      currentMesh.updateMatrixWorld(true);
      oldBox = computeModelBounds(currentMesh, currentAnimations);
    }

    clearCurrentMesh();

    let parseData = gltfData;
    if (gltfData instanceof Uint8Array) {
      parseData = gltfData.buffer.slice(
        gltfData.byteOffset,
        gltfData.byteOffset + gltfData.byteLength,
      );
    }

    new GLTFLoader().parse(
      parseData,
      "",
      (gltf) => {
        if (isGodotPlaying) {
          resolve();
          return;
        }
        currentMesh = gltf.scene;
        currentAnimations = gltf.animations || [];
        const isWireframe = wireframeCb ? wireframeCb.checked : false;
        const isBloom = bloomCb ? bloomCb.checked : false;
        bloomPass.enabled = isBloom && !isWireframe;

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

        let hasAnimOrCamera = false;

        if (cameraSelect) {
          if (gltfCameras.length > 0) {
            cameraSelect.style.display = "inline-block";
            cameraSelect.innerHTML = '<option value="">Free Camera</option>';
            gltfCameras.forEach((cam, idx) => {
              const opt = document.createElement("option");
              opt.value = idx;
              opt.innerText = cam.name || `Camera ${idx + 1}`;
              cameraSelect.appendChild(opt);
            });
            cameraSelect.value = "0";
            activeCamera = gltfCameras[0];
            controls.enabled = false;
            hasAnimOrCamera = true;
          } else {
            cameraSelect.style.display = "none";
            cameraSelect.value = "";
            activeCamera = camera;
            controls.enabled = true;
          }
        } else {
          activeCamera = camera;
          controls.enabled = true;
        }

        const w = viewerEl ? viewerEl.clientWidth : window.innerWidth;
        const h = viewerEl ? viewerEl.clientHeight : window.innerHeight;
        updateCameraAspect(activeCamera, w, h);
        renderPass.camera = activeCamera;

        if (currentAnimations.length) {
          mixer = new THREE.AnimationMixer(currentMesh);
          hasAnimOrCamera = true;
          if (animPlayBtn) animPlayBtn.style.display = "";
          if (animSelect) animSelect.style.display = "";
          animSelect.innerHTML = "";
          currentAnimations.forEach((clip, i) => {
            const opt = document.createElement("option");
            opt.value = i;
            opt.innerText = clip.name || `Animation ${i + 1}`;
            animSelect.appendChild(opt);
          });
          playAnimation(0);
        } else {
          if (animPlayBtn) animPlayBtn.style.display = "none";
          if (animSelect) animSelect.style.display = "none";
          currentAction = null;
          updateCaptureButtonState();
        }

        updateAnimTimelineVisibility();

        if (animControlsSection) {
          animControlsSection.style.display = hasAnimOrCamera ? "flex" : "none";
        }

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
          if (typeof fitCamera === "function") fitCamera();
        } else {
          if (newBox) {
            const size = newBox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 10;
            applyDynamicBoundsToLights(currentMesh, maxDim * 1.5);
          }

          const isPT = pathTracingCb && pathTracingCb.checked;
          const showGrid = showGridCb ? showGridCb.checked : true;
          if (typeof floor !== "undefined") floor.visible = !isPT;
          if (typeof lightGroup !== "undefined")
            lightGroup.visible =
              !isPT && (!sceneHasLights || (lightsCb && !lightsCb.checked));
          if (typeof gridHelper !== "undefined")
            gridHelper.visible = !isPT && showGrid;
          if (typeof axesHelper !== "undefined")
            axesHelper.visible = !isPT && showGrid;

          if (typeof pathTracer !== "undefined") {
            pathTracer.setScene(scene, activeCamera);
            pathTracer.updateCamera();
          }
        }
        resolve();
      },
      reject,
    );
  });
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

  const isPT = pathTracingCb && pathTracingCb.checked;
  const showGrid = showGridCb ? showGridCb.checked : true;

  if (typeof floor !== "undefined") floor.visible = !isPT;
  if (typeof lightGroup !== "undefined")
    lightGroup.visible =
      !isPT && (!sceneHasLights || (lightsCb && !lightsCb.checked));
  if (typeof gridHelper !== "undefined") gridHelper.visible = !isPT && showGrid;
  if (typeof axesHelper !== "undefined") axesHelper.visible = !isPT && showGrid;

  if (typeof pathTracer !== "undefined") {
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

  if (mixer) {
    if (!(pathTracingCb && pathTracingCb.checked) && !isRecording) {
      mixer.update(delta);
    }

    if (
      currentAction &&
      isPlaying &&
      !isDraggingSlider &&
      (!animTimelineCb || animTimelineCb.checked)
    ) {
      const duration = currentAction.getClip().duration;
      if (duration > 0) {
        let currentClipTime = currentAction.time % duration;
        if (currentClipTime < 0) currentClipTime += duration;
        animSlider.value = currentClipTime / duration;
      }
    }
  }

  controls.update();
  const isPT = pathTracingCb && pathTracingCb.checked;
  const showGrid = showGridCb ? showGridCb.checked : true;

  if (isPT) {
    if (typeof floor !== "undefined") floor.visible = false;
    if (typeof lightGroup !== "undefined") lightGroup.visible = false;
    if (typeof gridHelper !== "undefined") gridHelper.visible = false;
    if (typeof axesHelper !== "undefined") axesHelper.visible = false;

    if (typeof pathTracer !== "undefined" && !isRecording) {
      pathTracer.renderSample();
    }
  } else {
    if (typeof floor !== "undefined") floor.visible = true;
    if (typeof lightGroup !== "undefined")
      lightGroup.visible = lightGroup.visible =
        !sceneHasLights || (lightsCb && !lightsCb.checked);
    if (typeof gridHelper !== "undefined") gridHelper.visible = showGrid;
    if (typeof axesHelper !== "undefined") axesHelper.visible = showGrid;
    if (!isRecording) {
      composer.render();
    }
  }

  if (captureNextFrame) {
    captureNextFrame = false;
    renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${getDownloadName()}.png`);
    }, "image/png");
  }
}

window.addEventListener("resize", () => {
  if (!viewerEl || isRecording || isGodotPlaying) return;
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;

  updateCameraAspect(activeCamera, w, h);
  renderer.setSize(w, h);
  composer.setSize(w, h);

  if (typeof pathTracer !== "undefined") {
    pathTracer.updateCamera();
  }
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
      if (code !== null && editorEl.value !== code) {
        await maybeCreateAutoVersion("Before link load", true);
        editorEl.value = code;
        checkChanges();
        saveWorkspaceImmediate();
        if (isGodotPlaying) stopGodotPlayer({ skipCompile: true });
        compileAndRender(getEditorContent());
      }
    } catch (e) {
      console.error("Failed to decode hash on change", e);
    }
  } else {
    if (editorEl.value !== "") {
      await maybeCreateAutoVersion("Before clear", true);
      editorEl.value = "";
      checkChanges();
      saveWorkspaceImmediate();
      compileAndRender(getEditorContent());
    }
  }
});

(async function init() {
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
        if (editorEl.value.trim() && editorEl.value !== code) {
          await maybeCreateAutoVersion("Before shared link", true);
        }
        editorEl.value = code;
        saveWorkspaceImmediate();
      }
    } catch (e) {
      console.error("Failed to decode hash", e);
    }
  }

  checkChanges();
  syncMdFilesUi(editorEl.value);

  startScadViewerLoop();
  setTimeout(() => compileAndRender(getEditorContent()), 500);
})();
