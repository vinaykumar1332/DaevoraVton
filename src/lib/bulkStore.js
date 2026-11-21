// Bulk VTON browser storage. Its own IndexedDB database, separate from saved chats, so bulk
// history never touches chat data. Without IndexedDB (private windows, tests) it keeps data in memory.

const DB_NAME = 'vton-bulk';
const BATCHES = 'bulk_batches';
const JOBS = 'bulk_jobs';

const memory = { [BATCHES]: new Map(), [JOBS]: new Map() };
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(BATCHES, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        const jobs = db.createObjectStore(JOBS, { keyPath: 'key' });
        jobs.createIndex('batchId', 'batchId');
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

function run(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) return resolve(null);
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req?.result ?? null);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

/** Writes one record. Returns { ok, quota } so the page can tell the user when storage is full. */
async function put(store, value, key) {
  try {
    const db = await openDb();
    if (!db) {
      memory[store].set(key, value);
      return { ok: true };
    }
    await run(store, 'readwrite', (s) => s.put(value));
    return { ok: true };
  } catch (e) {
    return { ok: false, quota: e?.name === 'QuotaExceededError' };
  }
}

/** Saves a batch snapshot (the server copy is the source of truth; this is the browser's record). */
export function saveBatch(snapshot) {
  return put(BATCHES, { id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt, updatedAt: new Date().toISOString(), snapshot }, snapshot.id);
}

export async function saveJobs(batchId, jobs) {
  let last = { ok: true };
  for (const j of jobs) {
    const key = `${batchId}:${j.id}`;
    last = await put(JOBS, { key, batchId, ...j }, key);
    if (!last.ok) break;
  }
  return last;
}

export async function listBatches() {
  const db = await openDb();
  const rows = db ? (await run(BATCHES, 'readonly', (s) => s.getAll())) ?? [] : [...memory[BATCHES].values()];
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(({ snapshot, ...meta }) => ({ ...meta, summary: snapshot?.summary }));
}

export async function getBatch(id) {
  const db = await openDb();
  const row = db ? await run(BATCHES, 'readonly', (s) => s.get(id)) : memory[BATCHES].get(id);
  return row?.snapshot ?? null;
}

/** Clears the saved snapshot of one batch from this browser. The server copy is not touched. */
export async function forgetBatch(id) {
  const db = await openDb();
  if (db) await run(BATCHES, 'readwrite', (s) => s.delete(id));
  else memory[BATCHES].delete(id);
}
