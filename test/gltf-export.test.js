import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { convertScadToGltf } from "../src/convert.js";
import { installWasmFetchPolyfill } from "../src/process-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../ext/openscad.wasm");
const wasmUrl = pathToFileURL(wasmPath).href;

installWasmFetchPolyfill();

async function compileToGltfJson(scadCode, options = {}) {
  const gltfBytes = await convertScadToGltf(scadCode, {
    wasmUrl,
    binary: false,
    ...options,
  });
  return JSON.parse(new TextDecoder().decode(gltfBytes));
}

function parseGlb(glbBytes) {
  const view = new DataView(
    glbBytes.buffer,
    glbBytes.byteOffset,
    glbBytes.byteLength,
  );
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const totalLength = view.getUint32(8, true);

  assert.strictEqual(magic, 0x46546c67, "GLB magic should be 'glTF'");
  assert.strictEqual(version, 2, "GLB version should be 2");
  assert.strictEqual(totalLength, glbBytes.byteLength, "GLB total length");

  const jsonChunkLen = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);
  assert.strictEqual(jsonChunkType, 0x4e4f534a, "Chunk 0 should be JSON");

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonChunkLen;
  const json = JSON.parse(
    new TextDecoder().decode(glbBytes.subarray(jsonStart, jsonEnd)),
  );

  let bin = null;
  if (jsonEnd + 8 <= glbBytes.byteLength) {
    const binChunkLen = view.getUint32(jsonEnd, true);
    const binChunkType = view.getUint32(jsonEnd + 4, true);
    assert.strictEqual(binChunkType, 0x004e4942, "Chunk 1 should be BIN");
    bin = glbBytes.subarray(jsonEnd + 8, jsonEnd + 8 + binChunkLen);
  }

  return { json, bin };
}

test("glTF exporter - exports named materials and prevents merging distinct names", async () => {
  const scad = `
    color("red", name="lava", roughness=0.4, metalness=0.1)
      cube([2, 2, 2]);
    translate([5, 0, 0])
      color("red", name="ruby", roughness=0.4, metalness=0.1)
        cube([2, 2, 2]);
    translate([10, 0, 0])
      color("red", name="lava", roughness=0.4, metalness=0.1)
        cube([2, 2, 2]);
    translate([15, 0, 0])
      color("blue")
        cube([2, 2, 2]);
  `;

  const gltf = await compileToGltfJson(scad);

  assert.strictEqual(gltf.asset.version, "2.0");
  assert.strictEqual(
    gltf.materials.length,
    3,
    "Should deduplicate identical (lava) while keeping lava, ruby, and unnamed blue separate",
  );

  const byName = new Map(gltf.materials.map((m) => [m.name, m]));
  const lava = byName.get("lava");
  const ruby = byName.get("ruby");
  const unnamedBlue = gltf.materials.find((m) => !m.name);

  assert.ok(lava, "Should export material named 'lava'");
  assert.ok(ruby, "Should export material named 'ruby'");
  assert.ok(unnamedBlue, "Should export unnamed blue material without a name");

  assert.deepStrictEqual(
    lava.pbrMetallicRoughness.baseColorFactor,
    [1, 0, 0, 1],
  );
  assert.ok(Math.abs(lava.pbrMetallicRoughness.roughnessFactor - 0.4) < 1e-4);
  assert.ok(Math.abs(lava.pbrMetallicRoughness.metallicFactor - 0.1) < 1e-4);
  assert.deepStrictEqual(
    unnamedBlue.pbrMetallicRoughness.baseColorFactor,
    [0, 0, 1, 1],
  );

  // Verify binary GLB produces matching material names and valid binary buffer
  const glbBytes = await convertScadToGltf(scad, { wasmUrl, binary: true });
  const { json: glbJson, bin } = parseGlb(glbBytes);
  assert.ok(
    bin && bin.byteLength > 0,
    "GLB should contain non-empty BIN chunk",
  );
  assert.deepStrictEqual(
    glbJson.materials.map((m) => m.name),
    gltf.materials.map((m) => m.name),
  );
});

test("glTF exporter - exports PBR extensions and alpha blending", async () => {
  const scad = `
    color([0.1, 0.2, 0.3], alpha=0.5,
          clearcoat=0.8, clearcoatRoughness=0.2,
          emissive=[1.0, 0.5, 0.0], emissiveIntensity=2.5,
          ior=1.45, specularColor=[0.9, 0.8, 0.7], specularIntensity=0.6,
          iridescence=0.7, iridescenceIOR=1.4)
      cube([2, 2, 2]);

    translate([5, 0, 0])
      color("white", transmission=0.9, thickness=1.5,
            attenuationColor=[0.2, 0.8, 0.9], attenuationDistance=3.0)
        cube([2, 2, 2]);

    translate([10, 0, 0])
      color("green", sheen=0.9, sheenColor=[0.5, 1.0, 0.5], sheenRoughness=0.3, unlit=true)
        cube([2, 2, 2]);
  `;

  const gltf = await compileToGltfJson(scad);

  for (const ext of [
    "KHR_materials_clearcoat",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_specular",
    "KHR_materials_iridescence",
    "KHR_materials_transmission",
    "KHR_materials_volume",
    "KHR_materials_sheen",
    "KHR_materials_unlit",
  ]) {
    assert.ok(
      gltf.extensionsUsed?.includes(ext),
      `extensionsUsed should include ${ext}`,
    );
  }

  const blendMat = gltf.materials.find((m) => m.alphaMode === "BLEND");
  assert.ok(blendMat, "Alpha < 1 should set alphaMode to BLEND");
  assert.ok(
    Math.abs(blendMat.pbrMetallicRoughness.baseColorFactor[3] - 0.5) < 1e-4,
  );
  assert.ok(blendMat.extensions.KHR_materials_clearcoat);
  assert.ok(
    Math.abs(
      blendMat.extensions.KHR_materials_clearcoat.clearcoatFactor - 0.8,
    ) < 1e-4,
  );
  assert.ok(
    Math.abs(
      blendMat.extensions.KHR_materials_emissive_strength.emissiveStrength -
        2.5,
    ) < 1e-4,
  );

  const glassMat = gltf.materials.find(
    (m) => m.extensions?.KHR_materials_transmission,
  );
  assert.ok(glassMat);
  assert.ok(
    Math.abs(glassMat.extensions.KHR_materials_volume.thicknessFactor - 1.5) <
      1e-4,
  );

  const unlitMat = gltf.materials.find(
    (m) => m.extensions?.KHR_materials_unlit,
  );
  assert.ok(unlitMat);
  assert.ok(unlitMat.extensions.KHR_materials_sheen);
});

test("glTF exporter - converts Z-up to Y-up for armature, bones, cameras, animations, and skinning", async () => {
  const scad = `
    anim_data = [
      ["Walk", [
        ["TopBone", [
          [0.0, [0, 0, 0]],
          [1.0, [0, 45, 0]]
        ]]
      ]]
    ];

    armature(animations=anim_data) {
      skin(bones=["BaseBone", "TopBone"], weights=function(x,y,z) [1.0 - (z/4), z/4]) {
        color("cyan", name="skin_mat") cylinder(h=4, r=1, $fn=12);
      }

      bone(name="BaseBone", t=[1, 2, 3], r=[0, 0, 0]) {
        color("gray", name="rigid_mat") cube([2, 2, 1], center=true);
        bone(name="TopBone", t=[0, 0, 4], r=[0, 0, 0]) {}
        bone(name="Camera_fov60", t=[0, -5, 2], r=[0, 0, 0]) {}
      }
    }
  `;

  const gltf = await compileToGltfJson(scad);

  const nodeByName = new Map(gltf.nodes.map((n) => [n.name, n]));
  assert.ok(nodeByName.has("Armature"));
  assert.ok(nodeByName.has("BaseBone"));
  assert.ok(nodeByName.has("TopBone"));
  assert.ok(nodeByName.has("Camera_fov60"));

  // OpenSCAD [1, 2, 3] (Z-up) -> glTF [1, 3, -2] (Y-up)
  const baseBone = nodeByName.get("BaseBone");
  assert.deepStrictEqual(baseBone.translation, [1, 3, -2]);

  // Camera bone metadata
  const camNode = nodeByName.get("Camera_fov60");
  assert.strictEqual(camNode.camera, 0);
  assert.strictEqual(gltf.cameras[0].type, "perspective");
  assert.ok(
    Math.abs(gltf.cameras[0].perspective.yfov - (60 * Math.PI) / 180) < 1e-4,
  );

  // Skins & joints/weights attributes
  assert.strictEqual(gltf.skins.length, 1);
  assert.ok(gltf.skins[0].joints.length >= 2);
  assert.ok(gltf.skins[0].inverseBindMatrices !== undefined);

  const armatureMesh = gltf.meshes.find((m) => m.name === "Armature_Mesh");
  assert.ok(armatureMesh);
  const skinnedPrim = armatureMesh.primitives.find(
    (p) =>
      p.attributes.JOINTS_0 !== undefined &&
      p.attributes.WEIGHTS_0 !== undefined,
  );
  assert.ok(
    skinnedPrim,
    "Skinned primitive should have JOINTS_0 and WEIGHTS_0",
  );

  // Animations
  assert.strictEqual(gltf.animations.length, 1);
  assert.strictEqual(gltf.animations[0].name, "Walk");
  assert.strictEqual(gltf.animations[0].channels[0].target.path, "rotation");
});

test("glTF exporter - exports KHR_lights_punctual lights", async () => {
  const scad = `
    translate([0, 0, 10])
      light(type="spot", color=[1, 0.5, 0], intensity=500.0, range=25.0, innerConeAngle=15.0, outerConeAngle=30.0)
        cube([1, 1, 1]);
  `;

  const gltf = await compileToGltfJson(scad);

  assert.ok(gltf.extensionsUsed?.includes("KHR_lights_punctual"));
  const lights = gltf.extensions?.KHR_lights_punctual?.lights;
  assert.strictEqual(lights?.length, 1);
  assert.strictEqual(lights[0].type, "spot");
  assert.deepStrictEqual(lights[0].color, [1, 0.5, 0]);
  assert.strictEqual(lights[0].intensity, 500);
  assert.strictEqual(lights[0].range, 25);
  assert.ok(
    Math.abs(lights[0].spot.innerConeAngle - (15 * Math.PI) / 180) < 1e-4,
  );
  assert.ok(
    Math.abs(lights[0].spot.outerConeAngle - (30 * Math.PI) / 180) < 1e-4,
  );
});

test("glTF exporter - bakes colormap and high-to-low-poly textures with UVs and tangents", async () => {
  const scad = `
    bake(colors=true, normals=true, orm=true, resolution=32, msaa=1) {
      color([0.9, 0.1, 0.1], roughness=0.25, metalness=0.8) sphere(r=5, $fn=16);
      color("white", name="baked_mat", $asa=45) sphere(r=5, $fn=8);
    }
  `;

  const gltf = await compileToGltfJson(scad);

  assert.strictEqual(
    gltf.images.length,
    3,
    "Should bake color, normal, and ORM PNGs",
  );
  for (const img of gltf.images) {
    assert.ok(
      img.uri.startsWith("data:image/png;base64,"),
      "Baked image should be embedded PNG data URI",
    );
  }

  const mat = gltf.materials.find((m) => m.name === "baked_mat");
  assert.ok(mat, "Baked low-poly material should preserve its name");
  assert.ok(mat.pbrMetallicRoughness.baseColorTexture);
  assert.ok(mat.normalTexture);
  assert.ok(mat.pbrMetallicRoughness.metallicRoughnessTexture);

  const prim = gltf.meshes[0].primitives[0];
  assert.ok(prim.attributes.POSITION !== undefined);
  assert.ok(prim.attributes.NORMAL !== undefined);
  assert.ok(prim.attributes.TEXCOORD_0 !== undefined);
  assert.ok(prim.attributes.TANGENT !== undefined);
});
