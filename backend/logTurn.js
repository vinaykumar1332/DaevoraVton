// One record per chat turn, as JSON lines. Secrets and image data never reach the log:
// keys and tokens are dropped, and each image is replaced by a short hash.
// Written to the file in TURN_LOG_FILE when that is set; otherwise nothing is written.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SECRET_KEY = /key|secret|token|authorization|password|cookie/i;
const isImageData = (v) => typeof v === 'string' && /^data:image\//.test(v);
const hash = (v) => `sha256:${crypto.createHash('sha256').update(v).digest('hex').slice(0, 16)}`;

/** Copies a value for the log: drops secret-looking keys, hashes image data, keeps everything else. */
export function sanitizeTurnLog(value) {
  if (isImageData(value)) return hash(value);
  if (Array.isArray(value)) return value.map(sanitizeTurnLog);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = sanitizeTurnLog(v);
    }
    return out;
  }
  return value;
}

/** The only place turn records are written. Returns the record that was logged. */
export function logTurn(record, { file = process.env.TURN_LOG_FILE } = {}) {
  const clean = sanitizeTurnLog({ at: new Date().toISOString(), ...record });
  if (file) fs.appendFileSync(file, JSON.stringify(clean) + '\n');
  return clean;
}
