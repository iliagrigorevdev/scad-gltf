import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function initThreeJS(container, isPreview = false) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  const w = container ? container.clientWidth : window.innerWidth;
  const h = container ? container.clientHeight : window.innerHeight;

  const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
  camera.position.set(50, 50, -50);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: !isPreview,
  });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  if (container) container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.1, 0.1, 2.0);
  bloomPass.enabled = false;
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  if (!isPreview) controls.maxDistance = 2000;

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

  return {
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
  };
}

export function setupFullscreenAndScreenshot(
  fullscreenBtn,
  screenshotBtn,
  container,
  onCaptureRequest,
) {
  if (fullscreenBtn && container) {
    fullscreenBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        container.requestFullscreen().catch((err) => {
          console.warn(`Error attempting to enable fullscreen: ${err.message}`);
        });
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    document.addEventListener("fullscreenchange", () => {
      setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
    });
  }

  if (screenshotBtn) {
    screenshotBtn.addEventListener("click", () => {
      if (onCaptureRequest) onCaptureRequest();
      const originalText = screenshotBtn.innerText;
      screenshotBtn.innerText = "✅";
      setTimeout(() => {
        screenshotBtn.innerText = originalText;
      }, 1000);
    });
  }
}
