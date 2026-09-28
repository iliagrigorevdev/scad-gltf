import * as THREE from "three";

export function updateCameraAspect(cam, w, h) {
  if (!cam) return;
  if (cam.isPerspectiveCamera) {
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  } else if (cam.isOrthographicCamera) {
    const aspect = w / h;
    if (!cam.userData.ymag) cam.userData.ymag = cam.top;
    cam.left = -cam.userData.ymag * aspect;
    cam.right = cam.userData.ymag * aspect;
    cam.top = cam.userData.ymag;
    cam.bottom = -cam.userData.ymag;
    cam.updateProjectionMatrix();
  }
}

export function computeModelBounds(root, animations) {
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

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function padBase64(str) {
  const mod = str.length % 4;
  if (mod === 2) return str + "==";
  if (mod === 3) return str + "=";
  return str;
}

export async function encodeCode(code) {
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

export async function decodeCode(hash) {
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

export async function fetchDependencies(code, backendUrl, serverFiles) {
  const additionalFiles = {};
  if (!backendUrl) return additionalFiles;

  const visited = new Set();

  async function traverse(currentCode) {
    const regex = /(?:include|use)\s*([<"])([^>"]+)([>"])/g;
    let match;
    while ((match = regex.exec(currentCode)) !== null) {
      const relPath = match[2];
      const baseName = relPath.split(/[/\\]/).pop();

      if (!visited.has(relPath)) {
        if (serverFiles && !serverFiles.includes(baseName)) {
          continue;
        }

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

export function fitCameraToBox(camera, controls, dirLight, scene, worldBox) {
  const center = worldBox.getCenter(new THREE.Vector3());
  const size = worldBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 10;

  const fov = camera.fov * (Math.PI / 180);
  let distance = maxDim / (2 * Math.tan(fov / 2));
  if (camera.aspect < 1) distance /= camera.aspect;

  distance *= 1.5;

  camera.near = Math.max(0.01, maxDim * 0.01);
  camera.far = Math.max(2000, distance * 10);
  camera.updateProjectionMatrix();

  if (controls) {
    controls.maxDistance = camera.far;
    controls.target.copy(center);
    controls.update();
  }

  camera.position.set(
    center.x + distance * 0.8,
    center.y + distance * 0.8,
    center.z - distance * 0.8,
  );
  camera.lookAt(center);

  if (dirLight) {
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

  if (scene) {
    scene.fog = new THREE.Fog(0x222222, distance * 1.5, distance * 5);
  }

  return { center, size, maxDim, distance };
}

export function setupMeshShadowsAndWireframe(mesh, isWireframe) {
  mesh.traverse((child) => {
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

    if (child.isLight) {
      child.castShadow = true;
      if (child.shadow) {
        child.shadow.bias = -0.0005;
        child.shadow.normalBias = 0.02;
      }
    }
  });
}

export function applyDynamicBoundsToDirectionalLights(mesh, shadowCamSize) {
  mesh.traverse((child) => {
    if (child.isDirectionalLight && child.shadow) {
      child.shadow.camera.left = -shadowCamSize;
      child.shadow.camera.right = shadowCamSize;
      child.shadow.camera.top = shadowCamSize;
      child.shadow.camera.bottom = -shadowCamSize;
      child.shadow.camera.near = 0.1;
      child.shadow.camera.far = shadowCamSize * (5 / 1.5);
      child.shadow.camera.updateProjectionMatrix();

      child.shadow.mapSize.width = 2048;
      child.shadow.mapSize.height = 2048;
    }
  });
}

export function extractCamerasAndLights(mesh) {
  const gltfCameras = [];
  let sceneHasLights = false;
  mesh.traverse((child) => {
    if (child.isCamera) gltfCameras.push(child);
    if (child.isLight) sceneHasLights = true;
  });
  return { gltfCameras, sceneHasLights };
}
