import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { updateCameraAspect, setupMeshShadowsAndWireframe } from "./shared.js";

export function disposeThreeObject(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else if (child.material) {
        child.material.dispose();
      }
    }
  });
}

export function parseGlbBuffer(gltfData) {
  return new Promise((resolve, reject) => {
    let parseData = gltfData;
    if (gltfData instanceof Uint8Array) {
      parseData = gltfData.buffer.slice(
        gltfData.byteOffset,
        gltfData.byteOffset + gltfData.byteLength,
      );
    }
    new GLTFLoader().parse(parseData, "", resolve, reject);
  });
}

export function populateCameraSelect(
  cameraSelectEl,
  gltfCameras,
  defaultCamera,
  controls,
) {
  if (!cameraSelectEl) {
    if (controls) controls.enabled = true;
    return { activeCamera: defaultCamera, hasCameras: false };
  }

  if (gltfCameras.length > 0) {
    cameraSelectEl.style.display = "inline-block";
    cameraSelectEl.innerHTML = '<option value="">Free Camera</option>';
    gltfCameras.forEach((cam, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.innerText = cam.name || `Camera ${idx + 1}`;
      cameraSelectEl.appendChild(opt);
    });
    cameraSelectEl.value = "0";
    if (controls) controls.enabled = false;
    return { activeCamera: gltfCameras[0], hasCameras: true };
  }

  cameraSelectEl.style.display = "none";
  cameraSelectEl.value = "";
  if (controls) controls.enabled = true;
  return { activeCamera: defaultCamera, hasCameras: false };
}

export function createViewerContext({
  containerEl,
  width,
  height,
  preserveDrawingBuffer = false,
  PathTracerClass = null,
  onControlsChange = null,
  onHdrLoaded = null,
} = {}) {
  const initialW = width || containerEl?.clientWidth || window.innerWidth;
  const initialH = height || containerEl?.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  const camera = new THREE.PerspectiveCamera(
    60,
    initialW / initialH,
    0.1,
    2000,
  );
  camera.position.set(50, 50, -50);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer,
  });
  renderer.setSize(initialW, initialH);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (containerEl) {
    containerEl.appendChild(renderer.domElement);
  }

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(initialW, initialH),
    0.1,
    0.1,
    2.0,
  );
  bloomPass.enabled = false;
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const pathTracer = PathTracerClass ? new PathTracerClass(renderer) : null;
  if (pathTracer) {
    pathTracer.bounces = 10;
    pathTracer.transmissiveBounces = 10;
    pathTracer.multipleImportanceSampling = true;
    pathTracer.filterGlossyFactor = 0.2;
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.maxDistance = 2000;
  if (onControlsChange) {
    controls.addEventListener("change", onControlsChange);
  }

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

  let environmentTexture = null;

  const ctx = {
    scene,
    camera,
    renderer,
    composer,
    renderPass,
    bloomPass,
    controls,
    lightGroup,
    dirLight,
    hemiLight,
    floor,
    gridHelper,
    axesHelper,
    pathTracer,
    getEnvironmentTexture: () => environmentTexture,
    resize(w, h, activeCamera) {
      updateCameraAspect(activeCamera || camera, w, h);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      if (pathTracer) {
        pathTracer.updateCamera();
      }
    },
    applyBloom(enabled, isWireframe) {
      bloomPass.enabled = Boolean(enabled) && !Boolean(isWireframe);
    },
    applyPathTracingBackground(isPathTracing) {
      if (isPathTracing) {
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
    },
    syncEnvironmentVisibility({
      isPathTracing = false,
      showGrid = true,
      sceneHasLights = false,
      useCustomLights = true,
    } = {}) {
      floor.visible = !isPathTracing;
      lightGroup.visible =
        !isPathTracing && (!sceneHasLights || !useCustomLights);
      gridHelper.visible = !isPathTracing && showGrid;
      axesHelper.visible = !isPathTracing && showGrid;
    },
    loadHdrFromUrl(url, onSuccess, onError) {
      new HDRLoader().load(
        url,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          scene.environment = texture;
          environmentTexture = texture;
          if (onSuccess) onSuccess(texture, ctx);
        },
        undefined,
        (err) => {
          console.warn("Error loading HDR:", err);
          if (onError) onError(err);
        },
      );
    },
  };

  ctx.loadHdrFromUrl("./aristea_wreck_puresky_2k.hdr", (texture) => {
    if (onHdrLoaded) onHdrLoaded(texture, ctx);
  });

  return ctx;
}

export function bindViewerControls({
  wireframeCb,
  bloomCb,
  lightsCb,
  fullscreenBtn,
  fullscreenTarget,
  screenshotBtn,
  cameraSelect,
  onWireframeChange,
  onBloomChange,
  onLightsChange,
  onCameraChange,
  onScreenshot,
}) {
  if (wireframeCb && onWireframeChange) {
    wireframeCb.addEventListener("change", () => {
      onWireframeChange(wireframeCb.checked, bloomCb ? bloomCb.checked : false);
    });
  }

  if (bloomCb && onBloomChange) {
    bloomCb.addEventListener("change", () => {
      onBloomChange(bloomCb.checked, wireframeCb ? wireframeCb.checked : false);
    });
  }

  if (lightsCb && onLightsChange) {
    lightsCb.addEventListener("change", () => {
      onLightsChange(lightsCb.checked);
    });
  }

  if (cameraSelect && onCameraChange) {
    cameraSelect.addEventListener("change", (e) => {
      onCameraChange(e.target.value);
    });
  }

  if (fullscreenBtn && fullscreenTarget) {
    fullscreenBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        fullscreenTarget.requestFullscreen().catch((err) => {
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

  if (screenshotBtn && onScreenshot) {
    screenshotBtn.addEventListener("click", () => {
      onScreenshot();
      const originalText = screenshotBtn.innerText;
      screenshotBtn.innerText = "✅";
      setTimeout(() => {
        screenshotBtn.innerText = originalText;
      }, 1000);
    });
  }
}

export function createAnimationController({
  animControlsEl = null,
  animPlayBtn = null,
  animSelect = null,
  animSlider = null,
  animSliderRow = null,
  animTimelineLabel = null,
  animTimelineCb = null,
  hasTimelineClassTarget = null,
  onPlayStateChange = null,
  onScrub = null,
} = {}) {
  let mixer = null;
  let currentAction = null;
  let currentAnimations = [];
  let isPlaying = true;
  let isDraggingSlider = false;

  const notifyPlayState = () => {
    if (onPlayStateChange) onPlayStateChange({ currentAction, isPlaying });
  };

  const syncSliderToAction = () => {
    if (!currentAction || !animSlider) return;
    const duration = currentAction.getClip().duration;
    if (duration > 0) {
      let currentClipTime = currentAction.time % duration;
      if (currentClipTime < 0) currentClipTime += duration;
      animSlider.value = currentClipTime / duration;
    } else {
      animSlider.value = 0;
    }
  };

  const updateTimelineVisibility = () => {
    const hasAnims = currentAnimations.length > 0;
    const showTimeline =
      hasAnims && Boolean(animTimelineCb && animTimelineCb.checked);

    if (animTimelineLabel) {
      animTimelineLabel.style.display = hasAnims ? "flex" : "none";
    }
    if (animSliderRow) {
      animSliderRow.style.display = showTimeline ? "" : "none";
    } else if (animSlider) {
      animSlider.style.display = showTimeline ? "" : "none";
    }
    if (hasTimelineClassTarget) {
      hasTimelineClassTarget.classList.toggle("has-timeline", showTimeline);
    }
    if (showTimeline) {
      syncSliderToAction();
    }
  };

  const pause = () => {
    if (!currentAction) return;
    isPlaying = false;
    currentAction.paused = true;
    if (animPlayBtn) animPlayBtn.innerText = "▶ Play";
    notifyPlayState();
  };

  const play = (index) => {
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
    notifyPlayState();
  };

  if (animTimelineCb) {
    animTimelineCb.addEventListener("change", updateTimelineVisibility);
  }
  if (animSelect) {
    animSelect.addEventListener("change", (e) => {
      play(parseInt(e.target.value, 10));
    });
  }
  if (animPlayBtn) {
    animPlayBtn.addEventListener("click", () => {
      if (!currentAction) return;
      isPlaying = !isPlaying;
      currentAction.paused = !isPlaying;
      animPlayBtn.innerText = isPlaying ? "⏸ Pause" : "▶ Play";
      notifyPlayState();
    });
  }
  if (animSlider) {
    animSlider.addEventListener("mousedown", () => {
      isDraggingSlider = true;
      pause();
    });
    animSlider.addEventListener("mouseup", () => {
      isDraggingSlider = false;
    });
    animSlider.addEventListener(
      "touchstart",
      () => {
        isDraggingSlider = true;
        pause();
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
      pause();
      if (!currentAction) return;
      const duration = currentAction.getClip().duration;
      currentAction.time = parseFloat(e.target.value) * duration;
      if (mixer) {
        mixer.update(0);
        if (onScrub) onScrub();
      }
    });
  }

  return {
    setup(root, animations, hasCameras = false) {
      currentAnimations = animations || [];
      if (currentAnimations.length > 0) {
        mixer = new THREE.AnimationMixer(root);
        if (animControlsEl || animSelect) {
          if (animPlayBtn) animPlayBtn.style.display = "";
          if (animSelect) {
            animSelect.style.display = "";
            animSelect.innerHTML = "";
            currentAnimations.forEach((clip, i) => {
              const opt = document.createElement("option");
              opt.value = i;
              opt.innerText = clip.name || `Animation ${i + 1}`;
              animSelect.appendChild(opt);
            });
          }
          play(0);
        } else {
          currentAnimations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            action.play();
            action.time = 0;
          });
          mixer.update(0);
        }
      } else {
        if (animPlayBtn) animPlayBtn.style.display = "none";
        if (animSelect) animSelect.style.display = "none";
        currentAction = null;
        notifyPlayState();
      }

      updateTimelineVisibility();
      if (animControlsEl) {
        animControlsEl.style.display =
          currentAnimations.length > 0 || hasCameras ? "flex" : "none";
      }
    },
    clear() {
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(mixer.getRoot());
        mixer = null;
      }
      currentAction = null;
      currentAnimations = [];
      notifyPlayState();
    },
    update(delta, { pausePlayback = false } = {}) {
      if (!mixer) return;
      if (!pausePlayback) {
        mixer.update(delta);
      }
      if (
        currentAction &&
        isPlaying &&
        !isDraggingSlider &&
        (!animTimelineCb || animTimelineCb.checked)
      ) {
        syncSliderToAction();
      }
    },
    resetToZero() {
      if (mixer && currentAction) {
        currentAction.time = 0;
        mixer.update(0);
      }
    },
    getState() {
      return { mixer, currentAction, currentAnimations, isPlaying };
    },
  };
}

export { setupMeshShadowsAndWireframe };
