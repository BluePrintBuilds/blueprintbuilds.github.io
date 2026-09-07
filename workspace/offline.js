const DB_NAME = 'blueprint-plan-desk-v1';
const DB_VERSION = 1;
const PACK_STORE = 'plan-packs';
const QUEUE_STORE = 'markup-queue';
const PACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PACK_STORE)) db.createObjectStore(PACK_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'clientEventId' });
        store.createIndex('planKey', 'planKey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Blueprint offline storage could not open.'));
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Blueprint offline storage failed.'));
  });
}

async function withStore(name, mode, work) {
  const db = await openDb();
  try {
    const tx = db.transaction(name, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Blueprint offline storage was interrupted.'));
      tx.onerror = () => reject(tx.error || new Error('Blueprint offline storage failed.'));
    });
    const value = await work(tx.objectStore(name));
    await done;
    return value;
  } finally {
    db.close();
  }
}

export function planPackKey(projectId, planId) {
  return `${projectId}:${planId}`;
}

export async function savePlanPack({ projectId, planId, project, plan, role, markups, media }) {
  const now = Date.now();
  const pack = {
    key: planPackKey(projectId, planId),
    projectId,
    planId,
    project,
    plan,
    role,
    markups,
    media,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PACK_TTL_MS).toISOString(),
  };
  await withStore(PACK_STORE, 'readwrite', (store) => requestValue(store.put(pack)));
  return pack;
}

export async function getPlanPack(projectId, planId) {
  const key = planPackKey(projectId, planId);
  const pack = await withStore(PACK_STORE, 'readonly', (store) => requestValue(store.get(key)));
  if (!pack) return null;
  if (!pack.expiresAt || Date.parse(pack.expiresAt) <= Date.now()) {
    await removePlanPack(projectId, planId);
    return null;
  }
  return pack;
}

export async function removePlanPack(projectId, planId) {
  const key = planPackKey(projectId, planId);
  await withStore(PACK_STORE, 'readwrite', (store) => requestValue(store.delete(key)));
}

export async function refreshPackMarkups(projectId, planId, markups) {
  const pack = await getPlanPack(projectId, planId);
  if (!pack) return null;
  pack.markups = markups;
  pack.savedAt = new Date().toISOString();
  await withStore(PACK_STORE, 'readwrite', (store) => requestValue(store.put(pack)));
  return pack;
}

export async function queueMarkup(item) {
  await withStore(QUEUE_STORE, 'readwrite', (store) => requestValue(store.put(item)));
  return item;
}

export async function listQueuedMarkups(projectId, planId) {
  const key = planPackKey(projectId, planId);
  return withStore(QUEUE_STORE, 'readonly', (store) => new Promise((resolve, reject) => {
    const request = store.index('planKey').getAll(key);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error('Blueprint offline queue could not load.'));
  }));
}

export async function deleteQueuedMarkup(clientEventId) {
  await withStore(QUEUE_STORE, 'readwrite', (store) => requestValue(store.delete(clientEventId)));
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* browser decides */ }
  return false;
}

export async function storageSnapshot() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return { usage: Number(estimate?.usage || 0), quota: Number(estimate?.quota || 0) };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

export async function registerPlanDeskServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/workspace/plan-sw.js', { scope: '/workspace/' });
  } catch {
    return null;
  }
}
