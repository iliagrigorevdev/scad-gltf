import { convertScadToGltf } from "scad-gltf/convert";
import wasmUrl from "scad-gltf/openscad.wasm?url";
import {
  updateCameraAspect,
  computeModelBounds,
  downloadBlob,
  encodeCode,
  fetchDependencies,
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
import { extractModelNameFromScad } from "scad-gltf/utils";

const viewerContainer = document.getElementById("viewer-container");
const viewerEl = document.getElementById("viewer");
const renderTimeEl = document.getElementById("render-time");
const filenameInput = document.getElementById("filename-input");
const saveBtn = document.getElementById("save-btn");
const openEditorBtn = document.getElementById("open-editor-btn");

const showGridCb = document.getElementById("show-grid-cb");
const wireframeCb = document.getElementById("wireframe-cb");
const bloomCb = document.getElementById("bloom-cb");
const lightsCb = document.getElementById("lights-cb");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const screenshotBtn = document.getElementById("screenshot-btn");
const cameraSelect = document.getElementById("camera-select");

const animControls = document.getElementById("anim-controls");
const animPlayBtn = document.getElementById("anim-play-btn");
const animSelect = document.getElementById("anim-select");
const animSlider = document.getElementById("anim-slider");
const animTimelineLabel = document.getElementById("anim-timeline-label");
const animTimelineCb = document.getElementById("anim-timeline-cb");

let currentMesh = null;
let latestScadCode = "";
let isCompiling = false;
let pendingCode = null;
let captureNextFrame = false;

let gltfCameras = [];
let gltfLights = [];
let sceneHasLights = false;
let currentOptimalExposure = 1.0;

const viewerCtx = createViewerContext({
  containerEl: viewerEl,
  width: window.innerWidth,
  height: window.innerHeight,
  preserveDrawingBuffer: false,
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
} = viewerCtx;

let activeCamera = camera;

const animController = createAnimationController({
  animControlsEl: animControls,
  animPlayBtn,
  animSelect,
  animSlider,
  animTimelineLabel,
  animTimelineCb,
  hasTimelineClassTarget: animControls,
});

function applySceneLightingMode(useLights) {
  gltfLights.forEach((l) => (l.visible = useLights));
  scene.environmentIntensity = sceneHasLights && useLights ? 0.0 : 0.8;
  renderer.toneMappingExposure =
    sceneHasLights && useLights ? currentOptimalExposure : 1.0;
  viewerCtx.syncEnvironmentVisibility({
    isPathTracing: false,
    showGrid: showGridCb ? showGridCb.checked : true,
    sceneHasLights,
    useCustomLights: useLights,
  });
}

bindViewerControls({
  wireframeCb,
  bloomCb,
  lightsCb,
  fullscreenBtn,
  fullscreenTarget: viewerContainer,
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
    applySceneLightingMode(useLights);
  },
  onCameraChange: (val) => {
    if (val === "") {
      activeCamera = camera;
      controls.enabled = true;
    } else {
      activeCamera = gltfCameras[parseInt(val, 10)];
      controls.enabled = false;
    }
    const w = viewerContainer ? viewerContainer.clientWidth : window.innerWidth;
    const h = viewerContainer
      ? viewerContainer.clientHeight
      : window.innerHeight;
    updateCameraAspect(activeCamera, w, h);
    renderPass.camera = activeCamera;
  },
  onScreenshot: () => {
    captureNextFrame = true;
  },
});

let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = (now - lastTime) / 1000.0;
  lastTime = now;

  animController.update(delta);
  controls.update();

  viewerCtx.syncEnvironmentVisibility({
    isPathTracing: false,
    showGrid: showGridCb ? showGridCb.checked : true,
    sceneHasLights,
    useCustomLights: lightsCb ? lightsCb.checked : true,
  });

  composer.render();

  if (captureNextFrame) {
    captureNextFrame = false;
    const dataUrl = renderer.domElement.toDataURL("image/png");
    window.parent.postMessage({ type: "ADD_IMAGE_TO_CHAT", dataUrl }, "*");
  }
}
animate();

window.addEventListener("resize", () => {
  const w = viewerContainer ? viewerContainer.clientWidth : window.innerWidth;
  const h = viewerContainer ? viewerContainer.clientHeight : window.innerHeight;
  viewerCtx.resize(w, h, activeCamera);
});

async function renderGLTF(outputArray) {
  if (currentMesh) {
    animController.clear();
    scene.remove(currentMesh);
    disposeThreeObject(currentMesh);
    currentMesh = null;
  }

  const gltf = await parseGlbBuffer(outputArray);
  currentMesh = gltf.scene;
  const animations = gltf.animations || [];
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

  applySceneLightingMode(lightsCb ? lightsCb.checked : true);

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

  animController.setup(currentMesh, animations, camResult.hasCameras);
  setupMeshShadowsAndWireframe(currentMesh, isWireframe);

  scene.add(currentMesh);
  currentMesh.updateMatrixWorld(true);
  fitCamera(animations);
}

function fitCamera(animations = []) {
  if (!currentMesh) return;
  const worldBox = computeModelBounds(currentMesh, animations);
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
}

async function fetchDependenciesWrapper(code) {
  const backendUrl = "http://localhost:3000";
  let serverFiles = [];
  try {
    const res = await fetch(`${backendUrl}/api/scads`);
    if (res.ok) {
      const data = await res.json();
      serverFiles = data.files || [];
    }
  } catch (e) {
    return {};
  }
  return fetchDependencies(code, backendUrl, serverFiles);
}

async function compileAndRender(scadCode) {
  if (isCompiling) {
    pendingCode = scadCode;
    return;
  }
  isCompiling = true;

  if (renderTimeEl) {
    renderTimeEl.style.display = "block";
    renderTimeEl.innerText = "Compiling...";
  }

  const startTime = performance.now();

  try {
    const additionalFiles = await fetchDependenciesWrapper(scadCode);
    const gltfData = await convertScadToGltf(scadCode, {
      wasmUrl,
      additionalFiles,
    });

    await renderGLTF(gltfData);

    if (renderTimeEl) {
      const endTime = performance.now();
      renderTimeEl.innerText = `Rendered in ${((endTime - startTime) / 1000).toFixed(2)}s`;
    }
  } catch (e) {
    console.error(e);
    if (renderTimeEl) {
      renderTimeEl.innerText = "Compilation failed";
    }
  } finally {
    isCompiling = false;
    if (pendingCode !== null) {
      const codeToCompile = pendingCode;
      pendingCode = null;
      compileAndRender(codeToCompile);
    }
  }
}

window.addEventListener("message", async (event) => {
  if (event.data.type === "RENDER_SCAD") {
    latestScadCode = event.data.code;

    const extractedName = extractModelNameFromScad(latestScadCode);
    if (extractedName) {
      filenameInput.value = extractedName;
    }

    await compileAndRender(event.data.code);
  }
});

saveBtn.addEventListener("click", async () => {
  const filename = filenameInput.value.trim();
  if (!filename) {
    alert("Please enter a filename.");
    filenameInput.focus();
    return;
  }

  const backendUrl = "http://localhost:3000";

  try {
    saveBtn.innerText = "Checking...";
    saveBtn.disabled = true;

    const res = await fetch(`${backendUrl}/api/scads`);
    if (!res.ok) throw new Error("Could not reach `scad-gltf serve`.");

    const data = await res.json();
    const checkFilename = filename.toLowerCase().endsWith(".scad")
      ? filename
      : `${filename}.scad`;
    const fileExists = data.files && data.files.includes(checkFilename);

    if (fileExists) {
      const overwrite = confirm(
        `File "${checkFilename}" already exists. Overwrite?`,
      );
      if (!overwrite) {
        saveBtn.innerText = "Save";
        saveBtn.disabled = false;
        return;
      }
    }

    saveBtn.innerText = "Saving...";

    const saveRes = await fetch(`${backendUrl}/api/scads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content: latestScadCode || "" }),
    });

    if (!saveRes.ok) {
      const errData = await saveRes.json();
      throw new Error(errData.error || "Save failed.");
    }

    saveBtn.innerText = "✅ Saved!";
    setTimeout(() => {
      saveBtn.innerText = "Save";
      saveBtn.disabled = false;
    }, 2000);
  } catch (err) {
    console.warn(
      "Backend not connected or save failed, falling back to download",
      err,
    );

    const blob = new Blob([latestScadCode || ""], { type: "text/plain" });
    const checkFilename = filename.toLowerCase().endsWith(".scad")
      ? filename
      : `${filename}.scad`;
    downloadBlob(blob, checkFilename);

    saveBtn.innerText = "✅ Downloaded!";
    setTimeout(() => {
      saveBtn.innerText = "Save";
      saveBtn.disabled = false;
    }, 2000);
  }
});

openEditorBtn.addEventListener("click", async () => {
  if (!latestScadCode) {
    alert("No model loaded to open.");
    return;
  }

  try {
    openEditorBtn.disabled = true;
    openEditorBtn.innerText = "Preparing...";

    const hash = await encodeCode(latestScadCode);
    const url = `https://iliagrigorevdev.github.io/scad-gltf/#${hash}`;

    window.open(url, "_blank");
    window.parent.postMessage({ type: "CLOSE_PREVIEW" }, "*");

    openEditorBtn.innerText = "✅ Opened!";
    setTimeout(() => {
      openEditorBtn.innerText = "Edit";
      openEditorBtn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error("Error creating editor link", err);
    alert("Error creating editor link: " + err.message);
    openEditorBtn.innerText = "Edit";
    openEditorBtn.disabled = false;
  }
});
