import test from "node:test";
import assert from "node:assert";
import { register } from "node:module";

const mockThreeCode = `
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
  }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
}
export class Box3 {
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min; this.max = max;
  }
  setFromObject(obj) {
    const b = obj._boundsAt ? obj._boundsAt(obj.position) : obj._bounds;
    if (b) {
      this.min.copy(b.min);
      this.max.copy(b.max);
    }
    return this;
  }
  expandByObject(obj) {
    const b = obj._boundsAt ? obj._boundsAt(obj.position) : obj._bounds;
    if (b) {
      this.min.x = Math.min(this.min.x, b.min.x);
      this.min.y = Math.min(this.min.y, b.min.y);
      this.min.z = Math.min(this.min.z, b.min.z);
      this.max.x = Math.max(this.max.x, b.max.x);
      this.max.y = Math.max(this.max.y, b.max.y);
      this.max.z = Math.max(this.max.z, b.max.z);
    }
    return this;
  }
  isEmpty() { return this.max.x < this.min.x; }
  getCenter(target) {
    return target.set(
      (this.min.x + this.max.x) / 2,
      (this.min.y + this.max.y) / 2,
      (this.min.z + this.max.z) / 2,
    );
  }
  getSize(target) {
    return target.set(
      this.max.x - this.min.x,
      this.max.y - this.min.y,
      this.max.z - this.min.z,
    );
  }
}
export class AnimationMixer {
  constructor(root) { this.root = root; this.actions = []; }
  clipAction(clip) {
    const action = {
      time: 0,
      play: () => {},
      stop: () => {},
      clip,
    };
    this.actions.push(action);
    return action;
  }
  update() {
    for (const a of this.actions) {
      if (a.clip && typeof a.clip.onSample === "function") {
        a.clip.onSample(a.time, this.root);
      }
    }
  }
  stopAllAction() {}
  uncacheRoot() {}
}
export class Fog {
  constructor(color, near, far) {
    this.color = color; this.near = near; this.far = far;
  }
}
`;

const loaderSrc = `
const threeUrl = ${JSON.stringify(
  "data:text/javascript," + encodeURIComponent(mockThreeCode),
)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "three") {
    return { shortCircuit: true, url: threeUrl };
  }
  return nextResolve(specifier, context);
}
`;

register(
  "data:text/javascript," + encodeURIComponent(loaderSrc),
  import.meta.url,
);

const { Vector3, Box3 } = await import("three");

const {
  updateCameraAspect,
  computeModelBounds,
  downloadBlob,
  padBase64,
  encodeCode,
  decodeCode,
  fetchDependencies,
  getFileParam,
  extractFilenameFromUrl,
  fetchModelFromUrl,
  fitCameraToBox,
  setupMeshShadowsAndWireframe,
  applyDynamicBoundsToLights,
  extractCamerasAndLights,
} = await import("../editor/src/shared.js");

test("shared - padBase64 pads correctly", () => {
  assert.strictEqual(padBase64("abcd"), "abcd");
  assert.strictEqual(padBase64("ab"), "ab==");
  assert.strictEqual(padBase64("abc"), "abc=");
});

test("shared - encodeCode and decodeCode round-trip compressed, fallback, and legacy inputs", async () => {
  const sample = "// Unicode: 🚀\ncube([10, 20, 30]);";

  // Compressed path ("c...")
  const encoded = await encodeCode(sample);
  assert.ok(encoded.startsWith("c"));
  assert.strictEqual(await decodeCode(encoded), sample);

  // Fallback path ("u...") when CompressionStream is unavailable
  const origCS = globalThis.CompressionStream;
  globalThis.CompressionStream = undefined;
  try {
    const fallbackEncoded = await encodeCode(sample);
    assert.ok(fallbackEncoded.startsWith("u"));
    assert.strictEqual(await decodeCode(fallbackEncoded), sample);
  } finally {
    globalThis.CompressionStream = origCS;
  }

  // Legacy unprefixed base64 & null input
  const legacyB64 = btoa("cube(5);");
  assert.strictEqual(await decodeCode(legacyB64), "cube(5);");
  assert.strictEqual(await decodeCode(null), null);
  assert.strictEqual(await decodeCode(""), null);
});

test("shared - fetchDependencies resolves transitive includes and handles cycles/filters", async (t) => {
  const files = {
    "a.scad": 'include <sub/b.scad>\nuse "ignored.scad"',
    "b.scad": "include <a.scad>\nmodule b() {}",
    "ignored.scad": "module ig() {}",
  };

  t.mock.method(globalThis, "fetch", async (url) => {
    const name = decodeURIComponent(url.split("/").pop());
    if (files[name] !== undefined) {
      return { ok: true, json: async () => ({ content: files[name] }) };
    }
    return { ok: false };
  });

  const deps = await fetchDependencies(
    "include <a.scad>",
    "http://localhost:3000",
    ["a.scad", "b.scad"],
  );
  assert.deepStrictEqual(deps, {
    "a.scad": files["a.scad"],
    "sub/b.scad": files["b.scad"],
  });

  const empty = await fetchDependencies("include <a.scad>", "", null);
  assert.deepStrictEqual(empty, {});
});

test("shared - downloadBlob creates, clicks, and cleans up anchor element", (t) => {
  const events = [];
  const fakeLink = {
    href: "",
    download: "",
    click: () => events.push("click"),
  };

  globalThis.document = {
    createElement: (tag) => {
      assert.strictEqual(tag, "a");
      return fakeLink;
    },
    body: {
      appendChild: () => events.push("append"),
      removeChild: () => events.push("remove"),
    },
  };

  t.mock.method(URL, "createObjectURL", () => "blob:mock-url");
  t.mock.method(URL, "revokeObjectURL", (u) => events.push(`revoke:${u}`));

  try {
    downloadBlob(new Blob(["test"]), "model.scad");
    assert.strictEqual(fakeLink.href, "blob:mock-url");
    assert.strictEqual(fakeLink.download, "model.scad");
    assert.deepStrictEqual(events, [
      "append",
      "click",
      "remove",
      "revoke:blob:mock-url",
    ]);
  } finally {
    delete globalThis.document;
  }
});

test("shared - updateCameraAspect supports Perspective and Orthographic cameras", () => {
  let projUpdated = 0;
  const persp = {
    isPerspectiveCamera: true,
    aspect: 1,
    updateProjectionMatrix: () => projUpdated++,
  };
  updateCameraAspect(persp, 800, 400);
  assert.strictEqual(persp.aspect, 2);
  assert.strictEqual(projUpdated, 1);

  let orthoUpdated = 0;
  const ortho = {
    isOrthographicCamera: true,
    top: 10,
    bottom: -10,
    left: -10,
    right: 10,
    userData: {},
    updateProjectionMatrix: () => orthoUpdated++,
  };
  updateCameraAspect(ortho, 800, 400);
  assert.strictEqual(ortho.userData.ymag, 10);
  assert.strictEqual(ortho.left, -20);
  assert.strictEqual(ortho.right, 20);
  assert.strictEqual(ortho.top, 10);
  assert.strictEqual(ortho.bottom, -10);
  assert.strictEqual(orthoUpdated, 1);

  updateCameraAspect(null, 100, 100);
});

test("shared - computeModelBounds expands over animations and restores transforms", () => {
  const emptyBox = computeModelBounds(null, []);
  assert.strictEqual(emptyBox.isEmpty(), true);

  const root = {
    position: new Vector3(0, 0, 0),
    quaternion: { clone: () => ({ x: 0 }), copy: () => {} },
    scale: new Vector3(1, 1, 1),
    updateMatrixWorld: () => {},
    traverse: (cb) => cb(root),
    _boundsAt: (pos) => ({
      min: new Vector3(pos.x - 1, -1, -1),
      max: new Vector3(pos.x + 1, 1, 1),
    }),
  };

  const clip = {
    duration: 2,
    tracks: [{ times: [0, 1, 2] }],
    onSample: (t, r) => {
      r.position.x = t * 5;
    },
  };

  const box = computeModelBounds(root, [clip]);
  assert.strictEqual(box.min.x, -1);
  assert.strictEqual(box.max.x, 11);
  assert.strictEqual(root.position.x, 0);
});

test("shared - fitCameraToBox, setupMeshShadowsAndWireframe, applyDynamicBoundsToLights, and extractCamerasAndLights", () => {
  const cam = {
    fov: 60,
    aspect: 1,
    near: 0.1,
    far: 100,
    position: new Vector3(),
    updateProjectionMatrixCalled: false,
    lookedAt: null,
    updateProjectionMatrix() {
      this.updateProjectionMatrixCalled = true;
    },
    lookAt(v) {
      this.lookedAt = v.clone();
    },
  };
  const controls = {
    maxDistance: 0,
    target: new Vector3(),
    updated: false,
    update() {
      this.updated = true;
    },
  };
  const dirLight = {
    isLight: true,
    isDirectionalLight: true,
    intensity: 6.0,
    position: new Vector3(),
    target: { position: new Vector3(), updateMatrixWorld: () => {} },
    shadow: {
      bias: 0,
      normalBias: 0,
      mapSize: { width: 0, height: 0 },
      camera: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        near: 0,
        far: 0,
        updateProjectionMatrix: () => {},
      },
    },
  };
  const scene = {};
  const box = new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5));

  const fit = fitCameraToBox(cam, controls, dirLight, scene, box);
  assert.strictEqual(fit.maxDim, 10);
  assert.strictEqual(cam.updateProjectionMatrixCalled, true);
  assert.strictEqual(controls.updated, true);
  assert.ok(scene.fog);
  assert.strictEqual(dirLight.shadow.camera.right, 15);

  const mat1 = { wireframe: false };
  const mat2 = { wireframe: false };
  const camNode = { isCamera: true };
  const ptLight = {
    isLight: true,
    isPointLight: true,
    intensity: 6000,
    castShadow: false,
    shadow: {
      bias: 0,
      normalBias: 0,
      camera: { near: 0, far: 0, updateProjectionMatrix: () => {} },
    },
  };
  const meshNode = {
    isMesh: true,
    castShadow: false,
    receiveShadow: false,
    frustumCulled: true,
    material: [mat1, mat2],
  };
  const root = {
    traverse: (cb) => {
      cb(meshNode);
      cb(camNode);
      cb(dirLight);
      cb(ptLight);
    },
  };

  setupMeshShadowsAndWireframe(root, true);
  assert.strictEqual(meshNode.castShadow, true);
  assert.strictEqual(meshNode.receiveShadow, true);
  assert.strictEqual(meshNode.frustumCulled, false);
  assert.strictEqual(mat1.wireframe, true);
  assert.strictEqual(mat2.wireframe, true);
  assert.strictEqual(ptLight.castShadow, true);

  applyDynamicBoundsToLights(root, 30);
  assert.strictEqual(dirLight.shadow.mapSize.width, 2048);
  assert.strictEqual(dirLight.shadow.camera.far, 120);
  assert.strictEqual(ptLight.shadow.camera.far, 120);

  const extracted = extractCamerasAndLights(root);
  assert.strictEqual(extracted.gltfCameras.length, 1);
  assert.strictEqual(extracted.gltfLights.length, 2);
  assert.strictEqual(extracted.sceneHasLights, true);
  // expDir = 3/6 = 0.5, expPt = 3000/6000 = 0.5
  assert.strictEqual(extracted.optimalExposure, 0.5);
});

test("shared - getFileParam and extractFilenameFromUrl parse ?file= parameter", () => {
  assert.strictEqual(getFileParam(""), null);
  assert.strictEqual(getFileParam("?embed=1"), null);
  assert.strictEqual(getFileParam("?file=   "), null);
  assert.strictEqual(
    getFileParam("?embed=1&file=https%3A%2F%2Fexample.com%2Fgear.scad"),
    "https://example.com/gear.scad",
  );

  assert.strictEqual(
    extractFilenameFromUrl("https://example.com/models/my%20gear.scad?raw=1"),
    "my gear.scad",
  );
  assert.strictEqual(
    extractFilenameFromUrl("./projects/space_game.md"),
    "space_game.md",
  );
  assert.strictEqual(
    extractFilenameFromUrl("https://example.com/download?id=123"),
    null,
  );
  assert.strictEqual(
    extractFilenameFromUrl("blob:https://example.com/123"),
    null,
  );
  assert.strictEqual(extractFilenameFromUrl("data:text/plain,cube(1);"), null);
});

test("shared - fetchModelFromUrl fetches text content and rejects HTML or HTTP errors", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "https://example.com/demo/box.md") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/markdown" },
        text: async () => "### main.scad\n```openscad\ncube(5);\n```",
      };
    }
    if (
      url === "https://iliagrigorevdev.github.io/scad-gltf/models/gear.scad"
    ) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/plain" },
        text: async () => "cylinder(r=5, h=2);",
      };
    }
    if (url === "https://example.com/bad.scad") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/html" },
        text: async () => "<html>Not found</html>",
      };
    }
    return { ok: false, status: 404, statusText: "Not Found" };
  });

  const mdLoaded = await fetchModelFromUrl("https://example.com/demo/box.md");
  assert.deepStrictEqual(mdLoaded, {
    content: "### main.scad\n```openscad\ncube(5);\n```",
    name: "box.md",
  });

  const relLoaded = await fetchModelFromUrl(
    "models/gear.scad",
    "https://iliagrigorevdev.github.io/scad-gltf/",
  );
  assert.deepStrictEqual(relLoaded, {
    content: "cylinder(r=5, h=2);",
    name: "gear.scad",
  });

  await assert.rejects(
    () => fetchModelFromUrl("https://example.com/bad.scad"),
    /URL returned HTML/,
  );

  await assert.rejects(
    () => fetchModelFromUrl("https://example.com/missing.scad"),
    /404/,
  );
});
