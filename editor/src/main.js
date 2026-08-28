import { generatePrompt } from "scad-gltf/prompt";
import wasmUrl from "scad-gltf/openscad.wasm?url";
import { convertScadToGltf } from "scad-gltf/convert";
import * as THREE from "three";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  PROMPT_UI_HTML,
  setupPromptToggles,
  getPromptOptions,
} from "./prompt-ui.js";
import defaultScad from "./default.scad?raw";

// --- UI Elements ---
const promptDescEl = document.getElementById("prompt-desc");
const copyPromptBtn = document.getElementById("copy-prompt-btn");
const modelNameInputEl = document.getElementById("model-name-input");
const editorEl = document.getElementById("editor");
const renderBtn = document.getElementById("render-btn");
const loadScadBtn = document.getElementById("load-scad-btn");
const downloadScadBtn = document.getElementById("download-scad-btn");
const exportGltfBtn = document.getElementById("export-gltf-btn");
const captureImageBtn = document.getElementById("capture-image-btn");
const shareBtn = document.getElementById("share-btn");
const autoRenderCb = document.getElementById("auto-render-cb");

const statusEl = document.getElementById("status");
const viewerEl = document.getElementById("viewer");

const backendUrlEl = document.getElementById("backend-url");
const backendConnectBtn = document.getElementById("backend-connect-btn");
const backendUiEl = document.getElementById("backend-ui");
const backendSelectEl = document.getElementById("backend-select");
const backendSingleSaveBtn = document.getElementById("backend-single-save-btn");
const backendDeleteBtn = document.getElementById("backend-delete-btn");

const animControlsSection = document.getElementById("anim-controls-section");
const animPlayBtn = document.getElementById("anim-play-btn");
const animSelect = document.getElementById("anim-select");
const animSlider = document.getElementById("anim-slider");
const promptUiContainer = document.getElementById("prompt-ui-container");

let currentSelectedModelIdx = "";
let currentMesh = null;
let currentGltfData = null;
let currentAnimations = [];
let isCompiling = false;
let pendingCode = null;
let mixer = null;
let captureNextFrame = false;

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

// Helper to determine what to render
function getEditorContent() {
  return editorEl.value || defaultScad;
}

function getDownloadName() {
  return modelNameInputEl.value.trim() || "model";
}

modelNameInputEl.addEventListener("input", checkChanges);

// --- Prompt Logic ---
if (promptUiContainer) {
  promptUiContainer.innerHTML = PROMPT_UI_HTML;
  setupPromptToggles(promptUiContainer, "scad_editor_prompt_settings");
}

copyPromptBtn.onclick = async () => {
  const desc = promptDescEl.value.trim() || "an object";
  const options = getPromptOptions(promptUiContainer);

  const promptText = generatePrompt(desc, options);

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
async function fetchDependencies(code) {
  const additionalFiles = {};
  if (!isServerConnected) return additionalFiles;

  const visited = new Set();

  async function traverse(currentCode) {
    const regex = /(?:include|use)\s*([<"])([^>"]+)([>"])/g;
    let match;
    while ((match = regex.exec(currentCode)) !== null) {
      const relPath = match[2];
      const baseName = relPath.split(/[/\\]/).pop();

      if (!visited.has(relPath)) {
        visited.add(relPath);
        try {
          const res = await fetch(
            `${currentBackendUrl}/api/scads/${encodeURIComponent(baseName)}`,
          );
          if (res.ok) {
            const data = await res.json();
            additionalFiles[relPath] = data.content;
            await traverse(data.content);
          }
        } catch (err) {
          console.warn(`Failed to load dependency: ${relPath}`);
        }
      }
    }
  }

  await traverse(code);
  return additionalFiles;
}

async function compileAndRender(scadCode) {
  if (typeof scadCode !== "string") return;
  if (isCompiling) {
    pendingCode = scadCode;
    return;
  }

  if (scadCode.trim() === "") {
    clearCurrentMesh();
    statusEl.innerText = "Waiting for code...";
    return;
  }

  const nameMatch = scadCode.match(/\/\*\s*Model Name:\s*(.*?)\s*\*\//i);
  if (nameMatch && nameMatch[1]) {
    const extractedName = nameMatch[1]
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    if (extractedName && modelNameInputEl.value !== extractedName) {
      modelNameInputEl.value = extractedName;
      checkChanges();
    }
  }

  isCompiling = true;
  statusEl.innerText = "Compiling & Processing...";

  try {
    const additionalFiles = await fetchDependencies(scadCode);
    const opts = {
      wasmUrl: wasmUrl,
      additionalFiles: additionalFiles,
    };

    currentGltfData = await convertScadToGltf(scadCode, opts);

    statusEl.innerText = "Building Scene...";
    await rebuildSceneFromGLTF(currentGltfData);
    statusEl.innerText = "Rendering";
  } catch (e) {
    console.error(e);
    statusEl.innerText = "Compilation Error";
  } finally {
    isCompiling = false;
    if (pendingCode !== null) {
      const codeToCompile = pendingCode;
      pendingCode = null;
      compileAndRender(codeToCompile);
    }
  }
}

renderBtn.onclick = () => compileAndRender(getEditorContent());

let renderTimeout;
editorEl.addEventListener("input", () => {
  checkChanges();
  clearTimeout(renderTimeout);
  if (!autoRenderCb.checked) {
    statusEl.innerText = "Changes pending (click Render)";
    return;
  }
  statusEl.innerText = "Waiting to compile...";
  renderTimeout = setTimeout(() => {
    compileAndRender(getEditorContent());
  }, 800);
});

autoRenderCb.addEventListener("change", () => {
  if (autoRenderCb.checked) compileAndRender(getEditorContent());
});

loadScadBtn.onclick = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".scad";
  input.onchange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      try {
        const text = await e.target.files[0].text();
        editorEl.value = text;
        checkChanges();
        compileAndRender(text);
      } catch (err) {
        alert("Failed to read file: " + err.message);
      }
    }
  };
  input.click();
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

downloadScadBtn.onclick = () => {
  const codeToSave = getEditorContent();
  downloadBlob(
    new Blob([codeToSave], { type: "text/plain" }),
    `${getDownloadName()}.scad`,
  );
};

exportGltfBtn.onclick = () => {
  if (!currentGltfData) return;
  downloadBlob(
    new Blob([currentGltfData], { type: "application/octet-stream" }),
    `${getDownloadName()}.glb`,
  );
};

captureImageBtn.onclick = () => {
  captureNextFrame = true;
};

// --- Share Logic ---
function padBase64(str) {
  const mod = str.length % 4;
  if (mod === 2) return str + "==";
  if (mod === 3) return str + "=";
  return str;
}

async function encodeCode(code) {
  try {
    if (typeof CompressionStream !== "undefined") {
      const stream = new Blob([code])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
      const buffer = await new Response(stream).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
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

async function decodeCode(hash) {
  if (!hash) return null;
  const type = hash.charAt(0);
  let data = hash.substring(1);
  data = padBase64(data.replace(/-/g, "+").replace(/_/g, "/"));

  if (type === "c") {
    try {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      const buffer = await new Response(stream).arrayBuffer();
      return new TextDecoder().decode(buffer);
    } catch (e) {
      console.warn("DecompressionStream failed", e);
    }
  } else if (type === "u") {
    try {
      return decodeURIComponent(escape(atob(data)));
    } catch (e) {
      console.warn("Unescape failed", e);
    }
  } else {
    try {
      return decodeURIComponent(
        escape(atob(padBase64(hash.replace(/-/g, "+").replace(/_/g, "/")))),
      );
    } catch {
      return decodeURIComponent(hash);
    }
  }
  return null;
}

shareBtn.onclick = async () => {
  const code = editorEl.value.trim();
  const url = new URL(window.location.href);
  let finalUrl = "";

  if (!code || (!isServerConnected && code === defaultScad.trim())) {
    finalUrl = url.origin + url.pathname + url.search;
  } else {
    try {
      const hash = await encodeCode(editorEl.value);
      url.hash = hash;
      finalUrl = url.toString();
    } catch (err) {
      finalUrl = url.origin + url.pathname + url.search;
    }
  }

  window.history.replaceState(null, "", finalUrl);

  try {
    if (navigator.share) {
      const rawName = modelNameInputEl.value.trim();
      // Convert snake_case or kebab-case to Title Case (e.g., "my_model" -> "My Model")
      const displayTitle = rawName
        ? rawName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "Scadify";

      await navigator.share({
        title: displayTitle,
        url: finalUrl,
      });
      const originalText = shareBtn.innerText;
      shareBtn.innerText = "✅ Shared!";
      setTimeout(() => (shareBtn.innerText = originalText), 2000);
    } else {
      await navigator.clipboard.writeText(finalUrl);
      const originalText = shareBtn.innerText;
      shareBtn.innerText = "✅ Copied Link!";
      setTimeout(() => (shareBtn.innerText = originalText), 2000);
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      try {
        await navigator.clipboard.writeText(finalUrl);
        shareBtn.innerText = "✅ Copied Link!";
        setTimeout(() => (shareBtn.innerText = "🔗 Share"), 2000);
      } catch (fallbackErr) {
        alert("Failed to share or copy link.");
      }
    }
  }
};

// --- Drag and Drop SCAD ---
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
    if (
      file.name.toLowerCase().endsWith(".scad") ||
      !file.type ||
      file.type.includes("text")
    ) {
      try {
        const text = await file.text();
        editorEl.value = text;
        checkChanges();
        compileAndRender(text);
      } catch (err) {
        alert("Failed to read file: " + err.message);
      }
    } else {
      alert("Please drop a valid .scad file.");
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

  if (filename)
    filename =
      filename
        .replace(/\.scad$/i, "")
        .split(/[/\\]/)
        .pop() + ".scad";

  return { filename };
}

function checkChanges() {
  if (serverFiles === null) return;

  const isNew = backendSelectEl.value === "";
  const { filename } = getSanitizedNames();
  const currentContent = editorEl.value;

  let scadChanged = false;

  if (isNew) {
    if ((filename && filename !== ".scad") || currentContent.trim() !== "") {
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
    editorEl.placeholder = defaultScad;

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
    modelNameInputEl.value = filename.replace(/\.scad$/i, "");

    try {
      statusEl.innerText = "Loading from server...";
      const res = await fetch(
        `${currentBackendUrl}/api/scads/${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to load model");
      }
      const data = await res.json();
      editorEl.value = data.content;
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

  if (!filename || filename === ".scad") {
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
        `A model named "${filename}" already exists. Are you sure you want to overwrite it?`,
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

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
viewerEl.appendChild(renderer.domElement);

const pathTracer = new WebGLPathTracer(renderer);
pathTracer.bounces = 10;
pathTracer.transmissiveBounces = 10;
pathTracer.multipleImportanceSampling = true;

const controls = new OrbitControls(camera, renderer.domElement);
controls.addEventListener("change", () => {
  if (typeof pathTracer !== "undefined") pathTracer.updateCamera();
});

new HDRLoader().load(
  "./aristea_wreck_puresky_2k.hdr",
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
    if (typeof pathTracer !== "undefined") {
      pathTracer.setScene(scene, camera);
      pathTracer.updateCamera();
    }
  },
  undefined,
  (err) => console.warn("Error loading HDR:", err),
);

const pathTracingCb = document.getElementById("path-tracing-cb");
if (pathTracingCb) {
  pathTracingCb.addEventListener("change", () => {
    if (pathTracingCb.checked && typeof pathTracer !== "undefined") {
      pathTracer.setScene(scene, camera);
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

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);
scene.add(dirLight.target);

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

// --- Animation Controls ---
function playAnimation(index) {
  if (!mixer || !currentAnimations[index]) return;
  if (currentAction) {
    currentAction.stop();
  }
  const clip = currentAnimations[index];
  currentAction = mixer.clipAction(clip);
  currentAction.play();
  isPlaying = true;
  currentAction.paused = false;
  animPlayBtn.innerText = "⏸ Pause";
  animSlider.value = 0;
  if (statusEl)
    statusEl.innerText = `Playing: ${clip.name || `Animation ${index + 1}`}`;
}

animSelect.addEventListener("change", (e) => {
  playAnimation(parseInt(e.target.value));
});

animPlayBtn.addEventListener("click", () => {
  if (!currentAction) return;
  isPlaying = !isPlaying;
  currentAction.paused = !isPlaying;
  animPlayBtn.innerText = isPlaying ? "⏸ Pause" : "▶ Play";
});

animSlider.addEventListener("mousedown", () => {
  isDraggingSlider = true;
});
animSlider.addEventListener("mouseup", () => {
  isDraggingSlider = false;
});
animSlider.addEventListener(
  "touchstart",
  () => {
    isDraggingSlider = true;
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
  if (currentAction) {
    const duration = currentAction.getClip().duration;
    currentAction.time = parseFloat(e.target.value) * duration;
    if (mixer) {
      mixer.update(0);
      const pathTracingCb = document.getElementById("path-tracing-cb");
      if (
        pathTracingCb &&
        pathTracingCb.checked &&
        typeof pathTracer !== "undefined"
      ) {
        pathTracer.setScene(scene, camera);
      }
    }
  }
});

// --- GLTF Parsing & Rendering Logic ---
function clearCurrentMesh() {
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
}

function rebuildSceneFromGLTF(gltfData) {
  return new Promise((resolve, reject) => {
    let oldBox = null;
    if (currentMesh) {
      if (mixer && currentAction) {
        currentAction.time = 0;
        mixer.update(0);
        const pathTracingCb = document.getElementById("path-tracing-cb");
        if (
          pathTracingCb &&
          pathTracingCb.checked &&
          typeof pathTracer !== "undefined"
        ) {
          pathTracer.setScene(scene, camera);
        }
      }
      oldBox = new THREE.Box3().setFromObject(currentMesh);
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
        currentMesh = gltf.scene;
        currentAnimations = gltf.animations || [];

        if (currentAnimations.length) {
          mixer = new THREE.AnimationMixer(currentMesh);
          animControlsSection.style.display = "flex";
          animSelect.innerHTML = "";
          currentAnimations.forEach((clip, i) => {
            const opt = document.createElement("option");
            opt.value = i;
            opt.innerText = clip.name || `Animation ${i + 1}`;
            animSelect.appendChild(opt);
          });
          playAnimation(0);
        } else {
          animControlsSection.style.display = "none";
          currentAction = null;
        }

        currentMesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;
          }
        });

        scene.add(currentMesh);

        let geometryChanged = true;
        if (oldBox && !oldBox.isEmpty()) {
          const newBox = new THREE.Box3().setFromObject(currentMesh);
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
          if (typeof pathTracer !== "undefined") {
            pathTracer.setScene(scene, camera);
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
  const worldBox = new THREE.Box3().setFromObject(currentMesh);
  if (worldBox.isEmpty()) return;

  const center = worldBox.getCenter(new THREE.Vector3());
  const size = worldBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 10;

  floor.position.y = worldBox.min.y - 0.01;

  const fov = camera.fov * (Math.PI / 180);
  let distance = maxDim / (2 * Math.tan(fov / 2));
  if (camera.aspect < 1) distance /= camera.aspect;

  distance *= 1.5;

  camera.position.set(
    center.x + distance * 0.8,
    center.y + distance * 0.8,
    center.z - distance * 0.8,
  );
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();

  dirLight.position.set(
    center.x + maxDim,
    center.y + maxDim * 1.5,
    center.z - maxDim,
  );
  dirLight.target.position.copy(center);
  dirLight.target.updateMatrixWorld();

  const shadowCamSize = maxDim * 1.5;
  dirLight.shadow.camera.left = -shadowCamSize;
  dirLight.shadow.camera.right = shadowCamSize;
  dirLight.shadow.camera.top = shadowCamSize;
  dirLight.shadow.camera.bottom = -shadowCamSize;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = maxDim * 5;
  dirLight.shadow.camera.updateProjectionMatrix();

  const pathTracingCb = document.getElementById("path-tracing-cb");
  if (typeof lightGroup !== "undefined" && pathTracingCb) {
    lightGroup.visible = !pathTracingCb.checked;
  }
  if (typeof pathTracer !== "undefined") {
    pathTracer.setScene(scene, camera);
  }
}

// Animation loop
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = (now - lastTime) / 1000;
  lastTime = now;

  if (mixer) {
    const pathTracingCb = document.getElementById("path-tracing-cb");
    if (!(pathTracingCb && pathTracingCb.checked)) {
      mixer.update(delta);
    }

    if (currentAction && isPlaying && !isDraggingSlider) {
      const duration = currentAction.getClip().duration;
      if (duration > 0) {
        let currentClipTime = currentAction.time % duration;
        if (currentClipTime < 0) currentClipTime += duration;
        animSlider.value = currentClipTime / duration;
      }
    }
  }

  controls.update();
  const pathTracingCb = document.getElementById("path-tracing-cb");
  if (pathTracingCb && pathTracingCb.checked) {
    if (typeof lightGroup !== "undefined") lightGroup.visible = false;
    if (typeof pathTracer !== "undefined") pathTracer.renderSample();
  } else {
    if (typeof lightGroup !== "undefined") lightGroup.visible = true;
    renderer.render(scene, camera);
  }

  if (captureNextFrame) {
    captureNextFrame = false;
    renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${getDownloadName()}.png`);
    }, "image/png");
  }
}
animate();

window.addEventListener("resize", () => {
  if (!viewerEl) return;
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
setTimeout(() => window.dispatchEvent(new Event("resize")), 100);

editorEl.placeholder = defaultScad;

(async function init() {
  const isLocal = ["localhost", "127.0.0.1", ""].includes(
    window.location.hostname,
  );
  if (isLocal) {
    const url = backendUrlEl.value.trim();
    await connectToServer(url, true);
  }

  if (window.location.hash && window.location.hash.length > 1) {
    try {
      const hash = window.location.hash.substring(1);
      const code = await decodeCode(hash);
      if (code) {
        editorEl.value = code;
      }
    } catch (e) {
      console.error("Failed to decode hash", e);
    }
  }

  checkChanges();

  setTimeout(() => compileAndRender(getEditorContent()), 500);
})();
