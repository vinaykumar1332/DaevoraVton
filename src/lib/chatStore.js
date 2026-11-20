// Saved chats, per signed-in user, in the browser's IndexedDB (photos are data URIs and can be several MB,
// which is too much for localStorage). Falls back to memory when IndexedDB is not available
// (private windows in some browsers, tests), so the chat still works, it just is not kept.

const DB_NAME = 'vton-studio';
const STORE = 'chats';
export const MAX_CHATS = 30;

const memory = new Map();
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('owner', 'owner');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** The user's chats, newest first. Chats beyond MAX_CHATS are deleted. */
export async function listChats(owner) {
  const db = await openDb();
  const all = db
    ? await tx(db, 'readonly', (s) => s.index('owner').getAll(owner))
    : [...memory.values()].filter((c) => c.owner === owner);
  const sorted = (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const old of sorted.slice(MAX_CHATS)) await deleteChat(old.id);
  return sorted.slice(0, MAX_CHATS);
}

export async function saveChat(chat) {
  const db = await openDb();
  if (!db) return void memory.set(chat.id, structuredClone(chat));
  await tx(db, 'readwrite', (s) => s.put(chat));
}

export async function deleteChat(id) {
  const db = await openDb();
  if (!db) return void memory.delete(id);
  await tx(db, 'readwrite', (s) => s.delete(id));
}

/** Test helper. */
export const __resetMemoryStore = () => memory.clear();
