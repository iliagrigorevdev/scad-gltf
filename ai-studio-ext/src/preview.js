import { convertScadToGltf } from "openscad-gltf-wasm/convert";
import wasmUrl from "openscad-gltf-wasm/openscad.wasm?url";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const viewerEl = document.getElementById("viewer");
const statusEl = document.getElementById("status");
const filenameInput = document.getElementById("filename-input");
const saveBtn = document.getElementById("save-btn");
const openEditorBtn = document.getElementById("open-editor-btn");

let currentMesh = null;
let latestScadCode = "";
let isCompiling = false;
let pendingCode = null;
let mixer = null;

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
const floorGeo = new THREE.PlaneGeometry(2000, 2000);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x333333,
  roughness: 0.8,
  metalness: 0.1,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);
scene.add(dirLight.target);

let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = (now - lastTime) / 1000.0;
  lastTime = now;

  if (mixer) mixer.update(delta);
  controls.update();

  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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

        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(currentMesh);
          gltf.animations.forEach((clip) => {
            mixer.clipAction(clip).play();
          });
        }

        currentMesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;
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
  statusEl.innerText = "Compiling WASM...";

  try {
    const additionalFiles = await fetchDependencies(scadCode);
    const gltfData = await convertScadToGltf(scadCode, {
      wasmUrl,
      additionalFiles,
    });

    statusEl.innerText = "Loading Scene...";
    await renderGLTF(gltfData);

    statusEl.textContent = "";
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
    const url = `https://iliagrigorevdev.github.io/openscad-gltf-viewer/#${hash}`;

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
