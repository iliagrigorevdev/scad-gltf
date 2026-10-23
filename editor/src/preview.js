import { convertScadToGltf } from "scad-gltf/convert";
import wasmUrl from "scad-gltf/openscad.wasm?url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { initThreeJS, setupFullscreenAndScreenshot } from "./viewer-shared.js";
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

let currentMesh = null;
let currentAction = null;
let isPlaying = true;
let isDraggingSlider = false;
let currentAnimations = [];
let latestScadCode = "";
let isCompiling = false;
let pendingCode = null;
let mixer = null;
let captureNextFrame = false;

let gltfCameras = [];
let gltfLights = [];
let sceneHasLights = false;
let currentOptimalExposure = 1.0;
let activeCamera = null;

// --- Setup Three.js Scene ---
const {
  scene,
  camera,
  renderer,
  composer,
  renderPass,
  bloomPass,
  controls,
  lightGroup,
  dirLight,
  floor,
  gridHelper,
  axesHelper,
} = initThreeJS(viewerEl, true);
activeCamera = camera;

let environmentTexture = null;
new HDRLoader().load(
  "./aristea_wreck_puresky_2k.hdr",
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    environmentTexture = texture;
  },
  undefined,
  (err) => console.warn("Error loading HDR:", err),
);

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
    const w = viewerContainer ? viewerContainer.clientWidth : window.innerWidth;
    const h = viewerContainer
      ? viewerContainer.clientHeight
      : window.innerHeight;
    updateCameraAspect(activeCamera, w, h);
    renderPass.camera = activeCamera;
  });
}

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
    const useLights = lightsCb.checked;
    gltfLights.forEach((l) => (l.visible = useLights));
    scene.environmentIntensity = sceneHasLights && useLights ? 0.0 : 0.8;
    renderer.toneMappingExposure =
      sceneHasLights && useLights ? currentOptimalExposure : 1.0;
    if (typeof lightGroup !== "undefined") {
      lightGroup.visible = !sceneHasLights || !useLights;
    }
  });
}

setupFullscreenAndScreenshot(
  fullscreenBtn,
  screenshotBtn,
  viewerContainer,
  () => {
    captureNextFrame = true;
  },
);

function pauseAnimation() {
  if (!currentAction) return;
  isPlaying = false;
  currentAction.paused = true;
  if (animPlayBtn) animPlayBtn.innerText = "▶ Play";
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
  if (animPlayBtn) animPlayBtn.innerText = "⏸ Pause";
  if (animSlider) animSlider.value = 0;
}

if (animSelect) {
  animSelect.addEventListener("change", (e) => {
    playAnimation(parseInt(e.target.value));
  });
}

if (animPlayBtn) {
  animPlayBtn.addEventListener("click", () => {
    if (!currentAction) return;
    isPlaying = !isPlaying;
    currentAction.paused = !isPlaying;
    animPlayBtn.innerText = isPlaying ? "⏸ Pause" : "▶ Play";
  });
}

if (animSlider) {
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
      if (mixer) mixer.update(0);
    }
  });
}

let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = (now - lastTime) / 1000.0;
  lastTime = now;

  if (mixer) {
    mixer.update(delta);
    if (currentAction && isPlaying && !isDraggingSlider) {
      const duration = currentAction.getClip().duration;
      if (duration > 0) {
        let currentClipTime = currentAction.time % duration;
        if (currentClipTime < 0) currentClipTime += duration;
        if (animSlider) animSlider.value = currentClipTime / duration;
      }
    }
  }
  controls.update();

  const showGrid = showGridCb ? showGridCb.checked : true;
  gridHelper.visible = showGrid;
  axesHelper.visible = showGrid;

  if (typeof pathTracer !== "undefined" && currentAction && isPlaying) {
    pathTracer.updateCamera();
  }

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
  updateCameraAspect(activeCamera, w, h);
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

// --- GLTF Parsing & Rendering Logic ---
function renderGLTF(outputArray) {
  return new Promise((resolve, reject) => {
    if (currentMesh) {
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(mixer.getRoot());
        mixer = null;
      }
      currentAction = null;
      currentAnimations = [];
      scene.remove(currentMesh);
      currentMesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      currentMesh = null;
    }

    const arrayBuffer = outputArray.buffer.slice(
      outputArray.byteOffset,
      outputArray.byteOffset + outputArray.byteLength,
    );

    const loader = new GLTFLoader();
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => {
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
        if (typeof lightGroup !== "undefined") {
          lightGroup.visible = !sceneHasLights || !useLights;
        }

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

        if (currentAnimations.length > 0) {
          mixer = new THREE.AnimationMixer(currentMesh);
          hasAnimOrCamera = true;
          if (animControls) {
            if (animPlayBtn) animPlayBtn.style.display = "";
            if (animSelect) animSelect.style.display = "";
            if (animSlider) animSlider.style.display = "";
            animSelect.innerHTML = "";
            currentAnimations.forEach((clip, i) => {
              const opt = document.createElement("option");
              opt.value = i;
              opt.innerText = clip.name || `Animation ${i + 1}`;
              animSelect.appendChild(opt);
            });
            playAnimation(0);
          } else {
            currentAnimations.forEach((clip) => {
              const action = mixer.clipAction(clip);
              action.play();
              action.time = 0;
            });
            mixer.update(0);
          }
        } else {
          if (animControls) {
            if (animPlayBtn) animPlayBtn.style.display = "none";
            if (animSelect) animSelect.style.display = "none";
            if (animSlider) animSlider.style.display = "none";
          }
          currentAction = null;
        }

        if (animControls) {
          animControls.style.display = hasAnimOrCamera ? "flex" : "none";
        }

        setupMeshShadowsAndWireframe(currentMesh, isWireframe);

        scene.add(currentMesh);
        currentMesh.updateMatrixWorld(true);
        fitCamera();
        resolve();
      },
      (error) => {
        console.error(error);
        reject(error);
      },
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
    typeof dirLight !== "undefined" ? dirLight : null,
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

// --- Listen for Messages ---
window.addEventListener("message", async (event) => {
  if (event.data.type === "RENDER_SCAD") {
    latestScadCode = event.data.code;

    const nameMatch = latestScadCode.match(
      /\/\*\s*Model Name:\s*(.*?)\s*\*\//i,
    );
    if (nameMatch && nameMatch[1]) {
      let extractedName = nameMatch[1]
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");
      if (extractedName) {
        filenameInput.value = extractedName;
      }
    }

    await compileAndRender(event.data.code);
  }
});

// --- Save Functionality ---
saveBtn.addEventListener("click", async () => {
  let filename = filenameInput.value.trim();
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

// --- Edit Functionality (Share to External Viewer) ---
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
