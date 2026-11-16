import test from "node:test";
import assert from "node:assert";
import {
  DRAFT_MODEL_ID,
  loadAutoVersionPref,
  saveAutoVersionPref,
  loadActiveWorkspaceSync,
  saveActiveWorkspaceSync,
  getLocalModels,
  getLocalModel,
  saveLocalModel,
  deleteLocalModel,
  getModelVersions,
  createVersionSnapshot,
  deleteVersionSnapshot,
  migrateModelVersions,
} from "../editor/src/local-store.js";

function installMemoryLocalStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  return map;
}

function createMockIndexedDb() {
  const stores = {
    models: new Map(),
    versions: new Map(),
  };

  function makeReq(run) {
    const req = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      try {
        req.result = run(req);
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    });
    return req;
  }

  return {
    _stores: stores,
    open: () => {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({ createIndex: () => {} }),
        transaction: (storeNames, _mode) => {
          const tx = {
            oncomplete: null,
            onerror: null,
            error: null,
            objectStore: (name) => {
              const map = stores[name];
              return {
                getAll: () => makeReq(() => Array.from(map.values())),
                get: (key) => makeReq(() => map.get(key)),
                put: (val) => {
                  map.set(val.id, structuredClone(val));
                },
                delete: (key) => {
                  map.delete(key);
                },
                index: (indexName) => {
                  if (indexName !== "by_model") {
                    throw new Error(`Unknown index: ${indexName}`);
                  }
                  return {
                    getAll: (modelId) =>
                      makeReq(() =>
                        Array.from(map.values()).filter(
                          (v) => v.modelId === modelId,
                        ),
                      ),
                  };
                },
              };
            },
          };
          queueMicrotask(() => {
            if (tx.oncomplete) tx.oncomplete();
          });
          return tx;
        },
      };

      const openReq = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (openReq.onupgradeneeded) openReq.onupgradeneeded();
        if (openReq.onsuccess) openReq.onsuccess();
      });
      return openReq;
    },
  };
}

test("local-store - Auto version preference and active workspace sync", () => {
  installMemoryLocalStorage();
  delete globalThis.indexedDB;

  assert.strictEqual(loadAutoVersionPref(), true);
  saveAutoVersionPref(false);
  assert.strictEqual(loadAutoVersionPref(), false);
  saveAutoVersionPref(true);
  assert.strictEqual(loadAutoVersionPref(), true);

  assert.strictEqual(loadActiveWorkspaceSync(), null);

  const savedOk = saveActiveWorkspaceSync({
    activeModelId: "model_1",
    name: "rocket.scad",
    content: "cylinder(r=2, h=10);",
    entryFile: "main.scad",
  });
  assert.strictEqual(savedOk, true);

  const loaded = loadActiveWorkspaceSync();
  assert.strictEqual(loaded.activeModelId, "model_1");
  assert.strictEqual(loaded.name, "rocket.scad");
  assert.strictEqual(loaded.content, "cylinder(r=2, h=10);");
  assert.strictEqual(loaded.entryFile, "main.scad");
  assert.ok(typeof loaded.updatedAt === "number");

  globalThis.localStorage.setItem("scadify_active_workspace_v1", "{bad-json");
  assert.strictEqual(loadActiveWorkspaceSync(), null);
});

test("local-store - Models CRUD and sorting in localStorage fallback", async () => {
  installMemoryLocalStorage();
  delete globalThis.indexedDB;

  await saveLocalModel({
    id: DRAFT_MODEL_ID,
    name: "Draft",
    content: "cube(1);",
  });
  const m1 = await saveLocalModel({
    name: "First",
    content: "cube(2);",
    entryFile: "a.scad",
  });
  await new Promise((r) => setTimeout(r, 5));
  const m2 = await saveLocalModel({
    name: "Second",
    content: "sphere(3);",
  });

  const models = await getLocalModels();
  assert.strictEqual(models.length, 2);
  assert.strictEqual(models[0].id, m2.id);
  assert.strictEqual(models[1].id, m1.id);

  const updatedM1 = await saveLocalModel({
    id: m1.id,
    name: "First Updated",
    content: "cube(5);",
  });
  assert.strictEqual(updatedM1.createdAt, m1.createdAt);
  assert.ok(updatedM1.updatedAt >= m1.updatedAt);

  const fetched = await getLocalModel(m1.id);
  assert.strictEqual(fetched.name, "First Updated");
  assert.strictEqual(fetched.content, "cube(5);");

  await createVersionSnapshot({
    modelId: m1.id,
    content: "cube(5);",
    name: "First Updated",
    kind: "manual",
    label: "v1",
  });
  assert.strictEqual((await getModelVersions(m1.id)).length, 1);

  await deleteLocalModel(m1.id);
  assert.strictEqual(await getLocalModel(m1.id), null);
  assert.strictEqual((await getModelVersions(m1.id)).length, 0);
});

test("local-store - Version snapshots deduplication, pruning, deletion, and migration", async () => {
  installMemoryLocalStorage();
  delete globalThis.indexedDB;

  const r1 = await createVersionSnapshot({
    modelId: DRAFT_MODEL_ID,
    content: "cube(1);\nline2;",
    name: "box",
    kind: "auto",
  });
  assert.strictEqual(r1.created, true);
  assert.strictEqual(r1.version.versionNumber, 1);
  assert.strictEqual(r1.version.lineCount, 2);

  // Duplicate auto snapshot is skipped
  const rDup = await createVersionSnapshot({
    modelId: DRAFT_MODEL_ID,
    content: "cube(1);\nline2;",
    name: "box",
    kind: "auto",
  });
  assert.strictEqual(rDup.created, false);
  assert.strictEqual(rDup.version.id, r1.version.id);

  // Manual snapshot with a distinct label IS created even for identical content
  const rManual = await createVersionSnapshot({
    modelId: DRAFT_MODEL_ID,
    content: "cube(1);\nline2;",
    name: "box",
    kind: "manual",
    label: "Checkpoint",
  });
  assert.strictEqual(rManual.created, true);
  assert.strictEqual(rManual.version.kind, "manual");
  assert.strictEqual(rManual.version.versionNumber, 2);

  // Auto pruning with maxAutoVersions = 2 keeps manual snapshots intact
  await new Promise((r) => setTimeout(r, 3));
  await createVersionSnapshot({
    modelId: DRAFT_MODEL_ID,
    content: "cube(2);",
    name: "box",
    kind: "auto",
    maxAutoVersions: 2,
  });
  await new Promise((r) => setTimeout(r, 3));
  await createVersionSnapshot({
    modelId: DRAFT_MODEL_ID,
    content: "cube(3);",
    name: "box",
    kind: "auto",
    maxAutoVersions: 2,
  });

  const draftVersions = await getModelVersions(DRAFT_MODEL_ID);
  assert.strictEqual(draftVersions.length, 3); // 1 manual + 2 latest autos
  assert.ok(draftVersions.some((v) => v.id === rManual.version.id));
  assert.ok(!draftVersions.some((v) => v.id === r1.version.id));

  // Migrate versions to a saved model
  const targetModel = await saveLocalModel({
    name: "Migrated",
    content: "cube(3);",
  });
  await migrateModelVersions(DRAFT_MODEL_ID, targetModel.id);

  const migratedVersions = await getModelVersions(targetModel.id);
  assert.strictEqual(migratedVersions.length, 3);
  assert.strictEqual((await getModelVersions(DRAFT_MODEL_ID)).length, 0);

  await deleteVersionSnapshot(migratedVersions[0].id);
  assert.strictEqual((await getModelVersions(targetModel.id)).length, 2);
});

test("local-store - Uses IndexedDB when available", async () => {
  installMemoryLocalStorage();
  const mockIdb = createMockIndexedDb();
  globalThis.indexedDB = mockIdb;

  try {
    const saved = await saveLocalModel({
      name: "IDB Model",
      content: "sphere(10);",
    });
    assert.strictEqual(mockIdb._stores.models.size, 1);

    const fetched = await getLocalModel(saved.id);
    assert.strictEqual(fetched.name, "IDB Model");

    const allModels = await getLocalModels();
    assert.strictEqual(allModels.length, 1);

    const snap = await createVersionSnapshot({
      modelId: saved.id,
      content: "sphere(10);",
      name: "IDB Model",
      kind: "manual",
      label: "Initial",
    });
    assert.strictEqual(snap.created, true);
    assert.strictEqual(mockIdb._stores.versions.size, 1);

    const versions = await getModelVersions(saved.id);
    assert.strictEqual(versions.length, 1);
    assert.strictEqual(versions[0].label, "Initial");

    await migrateModelVersions(saved.id, "other_id");
    assert.strictEqual((await getModelVersions("other_id")).length, 1);

    await deleteVersionSnapshot(snap.version.id);
    assert.strictEqual(mockIdb._stores.versions.size, 0);

    await deleteLocalModel(saved.id);
    assert.strictEqual(mockIdb._stores.models.size, 0);
  } finally {
    delete globalThis.indexedDB;
  }
});
