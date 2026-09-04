import { convertScadToGltf } from "scad-gltf/convert";
import wasmUrl from "scad-gltf/openscad.wasm?url";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const viewerContainer = document.getElementById("viewer-container");
const viewerEl = document.getElementById("viewer");
const filenameInput = document.getElementById("filename-input");
const saveBtn = document.getElementById("save-btn");
const openEditorBtn = document.getElementById("open-editor-btn");

const showGridCb = document.getElementById("show-grid-cb");
const wireframeCb = document.getElementById("wireframe-cb");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const screenshotBtn = document.getElementById("screenshot-btn");

let currentMesh = null;
let currentAnimations = [];
let latestScadCode = "";
let isCompiling = false;
let pendingCode = null;
let mixer = null;
let captureNextFrame = false;

// --- Setup Three.js Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000,
);
camera.position.set(50, 50, -50);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Add Tone Mapping for realistic lighting display
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

viewerEl.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

// --- Add Room Environment for IBL ---
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(
  new RoomEnvironment(),
  0.04,
).texture;
scene.environmentIntensity = 0.8;

// Environment Helpers
const lightGroup = new THREE.Group();
scene.add(lightGroup);

const floorGeo = new THREE.PlaneGeometry(2000, 2000);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x222222,
  roughness: 0.8,
  metalness: 0.1,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const gridHelper = new THREE.GridHelper(2000, 100, 0x555555, 0x333333);
gridHelper.material.transparent = true;
gridHelper.material.opacity = 0.5;
scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(100);
scene.add(axesHelper);

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

// --- Viewer Toggles Logic ---
if (wireframeCb) {
  wireframeCb.addEventListener("change", () => {
    const isWireframe = wireframeCb.checked;
    if (currentMesh) {
      currentMesh.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              m.wireframe = isWireframe;
            });
          } else {
            child.material.wireframe = isWireframe;
          }
        }
      });
    }
  });
}

if (fullscreenBtn && viewerContainer) {
  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      viewerContainer.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn(`Error attempting to exit fullscreen: ${err.message}`);
      });
    }
  });

  document.addEventListener("fullscreenchange", () => {
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  });
}

if (screenshotBtn) {
  screenshotBtn.addEventListener("click", () => {
    captureNextFrame = true;
    const originalText = screenshotBtn.innerText;
    screenshotBtn.innerText = "✅";
    setTimeout(() => {
      screenshotBtn.innerText = originalText;
    }, 1000);
  });
}

let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = (now - lastTime) / 1000.0;
  lastTime = now;

  if (mixer) mixer.update(delta);
  controls.update();

  const showGrid = showGridCb ? showGridCb.checked : true;
  gridHelper.visible = showGrid;
  axesHelper.visible = showGrid;

  renderer.render(scene, camera);

  if (captureNextFrame) {
    captureNextFrame = false;
    const dataUrl = renderer.domElement.toDataURL("image/png");
    window.parent.postMessage({ type: "ADD_IMAGE_TO_CHAT", dataUrl }, "*");
  }
}
animate();

// Ensure renderer resizes to the full container size
window.addEventListener("resize", () => {
  const w = viewerContainer ? viewerContainer.clientWidth : window.innerWidth;
  const h = viewerContainer ? viewerContainer.clientHeight : window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// Computes the comprehensive bounding box of an object across rest pose and all animation frames
function computeModelBounds(root, animations) {
  if (!root) return new THREE.Box3();
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);

  if (!animations || animations.length === 0) {
    return box;
  }

  const savedTransforms = new Map();
  root.traverse((obj) => {
    savedTransforms.set(obj, {
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    });
  });

  const tempMixer = new THREE.AnimationMixer(root);

  for (const clip of animations) {
    const action = tempMixer.clipAction(clip);
    action.play();

    const sampleTimes = new Set([0, clip.duration]);
    if (clip.tracks) {
      for (const track of clip.tracks) {
        if (track.times) {
          for (let i = 0; i < track.times.length; i++) {
            sampleTimes.add(track.times[i]);
          }
        }
      }
    }

    const numSteps = 20;
    if (clip.duration > 0) {
      for (let i = 0; i <= numSteps; i++) {
        sampleTimes.add((i / numSteps) * clip.duration);
      }
    }

    let times = Array.from(sampleTimes).sort((a, b) => a - b);
    if (times.length > 60) {
      const sampled = [];
      const stride = (times.length - 1) / 59;
      for (let i = 0; i < 60; i++) {
        sampled.push(times[Math.round(i * stride)]);
      }
      times = sampled;
    }

    for (const time of times) {
      action.time = time;
      tempMixer.update(0);
      root.updateMatrixWorld(true);
      box.expandByObject(root);
    }

    action.stop();
  }

  tempMixer.stopAllAction();
  tempMixer.uncacheRoot(root);

  savedTransforms.forEach((t, obj) => {
    obj.position.copy(t.position);
    obj.quaternion.copy(t.quaternion);
    obj.scale.copy(t.scale);
  });
  root.updateMatrixWorld(true);

  return box;
}

// --- GLTF Parsing & Rendering Logic ---
function renderGLTF(outputArray) {
  return new Promise((resolve, reject) => {
    if (currentMesh) {
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(mixer.getRoot());
        mixer = null;
      }
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

        if (currentAnimations.length > 0) {
          mixer = new THREE.AnimationMixer(currentMesh);
          currentAnimations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            action.play();
            action.time = 0;
          });
          mixer.update(0);
        }

        currentMesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;

            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => {
                  m.wireframe = isWireframe;
                });
              } else {
                child.material.wireframe = isWireframe;
              }
            }
          }
        });

        scene.add(currentMesh);
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

  const center = worldBox.getCenter(new THREE.Vector3());
  const size = worldBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 10;

  floor.position.y = worldBox.min.y - 0.01;
  gridHelper.position.y = floor.position.y + 0.001;
  axesHelper.position.y = floor.position.y + 0.002;

  const fov = camera.fov * (Math.PI / 180);
  let distance = maxDim / (2 * Math.tan(fov / 2));
  if (camera.aspect < 1) distance /= camera.aspect;

  distance *= 1.5;

  camera.near = Math.max(0.01, maxDim * 0.01);
  camera.far = Math.max(2000, distance * 10);
  camera.updateProjectionMatrix();

  controls.maxDistance = camera.far;

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

  scene.fog = new THREE.Fog(0x222222, distance * 1.5, distance * 5);
}

async function fetchDependencies(code) {
  const additionalFiles = {};
  const backendUrl = "http://localhost:3000";
  let serverFiles = [];

  try {
    // Check if scad-serve backend is available to fetch potential include files
    const res = await fetch(`${backendUrl}/api/scads`);
    if (res.ok) {
      const data = await res.json();
      serverFiles = data.files || [];
    }
  } catch (e) {
    return additionalFiles; // If backend is offline, we can't resolve deps
  }

  const visited = new Set();

  async function traverse(currentCode) {
    const regex = /(?:include|use)\s*([<"])([^>"]+)([>"])/g;
    let match;
    while ((match = regex.exec(currentCode)) !== null) {
      const relPath = match[2];
      const baseName = relPath.split(/[/\\]/).pop();

      if (!visited.has(relPath) && serverFiles.includes(baseName)) {
        visited.add(relPath);
        try {
          const res = await fetch(
            `${backendUrl}/api/scads/${encodeURIComponent(baseName)}`,
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
  if (isCompiling) {
    pendingCode = scadCode;
    return;
  }
  isCompiling = true;

  try {
    const additionalFiles = await fetchDependencies(scadCode);
    const gltfData = await convertScadToGltf(scadCode, {
      wasmUrl,
      additionalFiles,
    });

    await renderGLTF(gltfData);
  } catch (e) {
    console.error(e);
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
    if (!res.ok) throw new Error("Could not reach scad-serve.");

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
    console.error(err);
    alert("Error saving file: " + err.message);
    saveBtn.innerText = "Save";
    saveBtn.disabled = false;
  }
});

// --- Edit Functionality (Share to External Viewer) ---
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
