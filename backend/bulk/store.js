// Bulk batches on the local disk: one folder per batch, with the images and a manifest.
// Batches are private to the user who created them. Other users get "not found".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.cwd(), 'backend/bulk/data');
const ID = /^[0-9a-f-]{36}$/;

const dirOf = (id) => {
  if (!ID.test(id)) return null;
  return path.join(ROOT, id);
};

export function createBatch({ owner, name, images, rejected }) {
  const id = crypto.randomUUID();
  const dir = dirOf(id);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  for (const img of images) fs.writeFileSync(path.join(dir, 'images', img.name), img.bytes);
  const manifest = {
    id,
    owner,
    name: String(name || 'Batch').slice(0, 80),
    createdAt: new Date().toISOString(),
    images: images.map(({ name: n, type, width, height, sha256 }) => ({ name: n, type, width, height, sha256 })),
    rejected,
    mapping: null,
    jobs: [],
  };
  saveManifest(manifest);
  return manifest;
}

export function saveManifest(manifest) {
  const dir = dirOf(manifest.id);
  const tmp = path.join(dir, 'manifest.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, path.join(dir, 'manifest.json'));
}

/** The batch when it exists and belongs to this user, otherwise null. */
export function loadBatch(id, owner) {
  const dir = dirOf(id);
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return manifest.owner === owner ? manifest : null;
}

/** Image bytes for one file of the batch. The name must be one that the manifest lists. */
export function readImage(id, name) {
  const dir = dirOf(id);
  if (!dir || path.basename(name) !== name) return null;
  const file = path.join(dir, 'images', name);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

export const storeRoot = ROOT;
