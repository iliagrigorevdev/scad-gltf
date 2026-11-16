const ACTIVE_WORKSPACE_KEY = "scadify_active_workspace_v1";
const AUTO_VERSION_PREF_KEY = "scadify_auto_version_v1";
const FALLBACK_MODELS_KEY = "scadify_local_models_fallback_v1";
const FALLBACK_VERSIONS_KEY = "scadify_local_versions_fallback_v1";

const DB_NAME = "scadify_local_db";
const DB_VERSION = 1;
const STORE_MODELS = "models";
const STORE_VERSIONS = "versions";

export const DRAFT_MODEL_ID = "__draft__";

let dbPromise = null;

function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}_${str.length}`;
}

function getUtf8ByteLength(str) {
  try {
    return new TextEncoder().encode(str).length;
  } catch {
    return str.length;
  }
}

function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
        const versionStore = db.createObjectStore(STORE_VERSIONS, {
          keyPath: "id",
        });
        versionStore.createIndex("by_model", "modelId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error("Failed to open IndexedDB"));
    };
  });

  return dbPromise;
}

function readFallbackJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function writeFallbackJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("localStorage fallback write failed:", err);
  }
}

export function loadAutoVersionPref() {
  try {
    const val = localStorage.getItem(AUTO_VERSION_PREF_KEY);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

export function saveAutoVersionPref(enabled) {
  try {
    localStorage.setItem(AUTO_VERSION_PREF_KEY, String(Boolean(enabled)));
  } catch {}
}

export function loadActiveWorkspaceSync() {
  try {
    const raw = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      activeModelId: parsed.activeModelId || DRAFT_MODEL_ID,
      name: typeof parsed.name === "string" ? parsed.name : "",
      content: typeof parsed.content === "string" ? parsed.content : "",
      entryFile: typeof parsed.entryFile === "string" ? parsed.entryFile : null,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveActiveWorkspaceSync({
  activeModelId = DRAFT_MODEL_ID,
  name = "",
  content = "",
  entryFile = null,
}) {
  try {
    localStorage.setItem(
      ACTIVE_WORKSPACE_KEY,
      JSON.stringify({
        activeModelId: activeModelId || DRAFT_MODEL_ID,
        name: String(name ?? ""),
        content: String(content ?? ""),
        entryFile: entryFile || null,
        updatedAt: Date.now(),
      }),
    );
    return true;
  } catch (err) {
    console.warn("Failed to persist active workspace:", err);
    return false;
  }
}

export async function getLocalModels() {
  try {
    const db = await openDb();
    const models = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MODELS, "readonly");
      const req = tx.objectStore(STORE_MODELS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return models
      .filter((m) => m && m.id !== DRAFT_MODEL_ID)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    const models = readFallbackJson(FALLBACK_MODELS_KEY, []);
    return models
      .filter((m) => m && m.id !== DRAFT_MODEL_ID)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
}

export async function getLocalModel(id) {
  if (!id) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MODELS, "readonly");
      const req = tx.objectStore(STORE_MODELS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const models = readFallbackJson(FALLBACK_MODELS_KEY, []);
    return models.find((m) => m.id === id) || null;
  }
}

export async function saveLocalModel({ id, name, content, entryFile = null }) {
  const now = Date.now();
  const existing = id ? await getLocalModel(id) : null;
  const record = {
    id: id || `local_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: String(name ?? ""),
    content: String(content ?? ""),
    entryFile: entryFile || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MODELS, "readwrite");
      tx.objectStore(STORE_MODELS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const models = readFallbackJson(FALLBACK_MODELS_KEY, []);
    const idx = models.findIndex((m) => m.id === record.id);
    if (idx >= 0) models[idx] = record;
    else models.push(record);
    writeFallbackJson(FALLBACK_MODELS_KEY, models);
  }

  return record;
}

export async function deleteLocalModel(id) {
  if (!id) return;
  try {
    const db = await openDb();
    const versions = await getModelVersions(id);
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MODELS, STORE_VERSIONS], "readwrite");
      tx.objectStore(STORE_MODELS).delete(id);
      const vStore = tx.objectStore(STORE_VERSIONS);
      for (const v of versions) {
        vStore.delete(v.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const models = readFallbackJson(FALLBACK_MODELS_KEY, []).filter(
      (m) => m.id !== id,
    );
    const versions = readFallbackJson(FALLBACK_VERSIONS_KEY, []).filter(
      (v) => v.modelId !== id,
    );
    writeFallbackJson(FALLBACK_MODELS_KEY, models);
    writeFallbackJson(FALLBACK_VERSIONS_KEY, versions);
  }
}

export async function getModelVersions(modelId = DRAFT_MODEL_ID) {
  const targetId = modelId || DRAFT_MODEL_ID;
  try {
    const db = await openDb();
    const versions = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VERSIONS, "readonly");
      const index = tx.objectStore(STORE_VERSIONS).index("by_model");
      const req = index.getAll(targetId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return versions.sort(
      (a, b) =>
        (b.createdAt || 0) - (a.createdAt || 0) ||
        (b.versionNumber || 0) - (a.versionNumber || 0),
    );
  } catch {
    const versions = readFallbackJson(FALLBACK_VERSIONS_KEY, []).filter(
      (v) => v.modelId === targetId,
    );
    return versions.sort(
      (a, b) =>
        (b.createdAt || 0) - (a.createdAt || 0) ||
        (b.versionNumber || 0) - (a.versionNumber || 0),
    );
  }
}

export async function createVersionSnapshot({
  modelId = DRAFT_MODEL_ID,
  content = "",
  name = "",
  entryFile = null,
  kind = "auto",
  label = "",
  maxAutoVersions = 50,
}) {
  const targetId = modelId || DRAFT_MODEL_ID;
  const normalizedContent = String(content ?? "");
  const normalizedName = String(name ?? "");
  const cleanLabel = String(label ?? "").trim();
  const contentHash = hashString(normalizedContent);

  const existing = await getModelVersions(targetId);
  const latest = existing[0] || null;

  if (
    latest &&
    latest.contentHash === contentHash &&
    latest.content === normalizedContent &&
    latest.name === normalizedName &&
    (kind === "auto" || !cleanLabel || latest.label === cleanLabel)
  ) {
    return { created: false, version: latest };
  }

  const nextNumber =
    existing.reduce((max, v) => Math.max(max, v.versionNumber || 0), 0) + 1;
  const now = Date.now();
  const record = {
    id: `ver_${targetId}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    modelId: targetId,
    versionNumber: nextNumber,
    kind: kind === "manual" ? "manual" : "auto",
    label: cleanLabel,
    content: normalizedContent,
    name: normalizedName,
    entryFile: entryFile || null,
    contentHash,
    lineCount: normalizedContent ? normalizedContent.split("\n").length : 0,
    byteLength: getUtf8ByteLength(normalizedContent),
    createdAt: now,
  };

  const autoVersions = existing.filter((v) => v.kind !== "manual");
  const idsToPrune = [];
  if (record.kind === "auto" && autoVersions.length >= maxAutoVersions) {
    const excess = autoVersions.slice(maxAutoVersions - 1);
    for (const old of excess) {
      idsToPrune.push(old.id);
    }
  }

  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VERSIONS, "readwrite");
      const store = tx.objectStore(STORE_VERSIONS);
      store.put(record);
      for (const oldId of idsToPrune) {
        store.delete(oldId);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const pruneSet = new Set(idsToPrune);
    const all = readFallbackJson(FALLBACK_VERSIONS_KEY, []).filter(
      (v) => !pruneSet.has(v.id),
    );
    all.push(record);
    writeFallbackJson(FALLBACK_VERSIONS_KEY, all);
  }

  return { created: true, version: record };
}

export async function deleteVersionSnapshot(versionId) {
  if (!versionId) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VERSIONS, "readwrite");
      tx.objectStore(STORE_VERSIONS).delete(versionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const all = readFallbackJson(FALLBACK_VERSIONS_KEY, []).filter(
      (v) => v.id !== versionId,
    );
    writeFallbackJson(FALLBACK_VERSIONS_KEY, all);
  }
}

export async function migrateModelVersions(fromModelId, toModelId) {
  if (!fromModelId || !toModelId || fromModelId === toModelId) return;
  const sourceVersions = await getModelVersions(fromModelId);
  if (sourceVersions.length === 0) return;

  const updated = sourceVersions.map((v) => ({ ...v, modelId: toModelId }));

  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VERSIONS, "readwrite");
      const store = tx.objectStore(STORE_VERSIONS);
      for (const v of updated) {
        store.put(v);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const all = readFallbackJson(FALLBACK_VERSIONS_KEY, []).map((v) =>
      v.modelId === fromModelId ? { ...v, modelId: toModelId } : v,
    );
    writeFallbackJson(FALLBACK_VERSIONS_KEY, all);
  }
}
