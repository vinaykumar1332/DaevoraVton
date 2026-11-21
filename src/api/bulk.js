// Client for the local bulk API (/api/bulk). Every call needs the signed-in session cookie.
import { BULK } from './endpoints.js';

const MAX_ZIP = 60 * 1024 * 1024;
const MAX_SHEET = 2 * 1024 * 1024;

function failure(status, data) {
  const e = data?.error ?? {};
  return Object.assign(new Error(e.message || 'The bulk request failed.'), { code: e.name || `HTTP${status}`, status });
}

async function json(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw failure(res.status, data);
  return data;
}

/** True when the local bulk backend answers. Without it the app returns its HTML page, not JSON. */
export async function bulkServerReady() {
  try {
    const res = await fetch(`${BULK}/batches/none`);
    return (res.headers.get('content-type') || '').includes('application/json');
  } catch {
    return false;
  }
}

/** Uploads a ZIP and reports progress as a fraction from 0 to 1. */
export function uploadZip(file, name, onProgress) {
  if (file.size > MAX_ZIP) return Promise.reject(Object.assign(new Error('The ZIP is larger than 60 MB.'), { code: 'ZipTooLarge' }));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BULK}/batches?name=${encodeURIComponent(name || file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(failure(xhr.status, data));
    };
    xhr.onerror = () => reject(Object.assign(new Error('Could not reach the server. Check that the backend is running.'), { code: 'Network' }));
    xhr.send(file);
  });
}

/** Sends a CSV or Excel mapping file. */
export async function uploadMappingFile(batchId, file) {
  if (file.size > MAX_SHEET) throw Object.assign(new Error('The mapping file is larger than 2 MB.'), { code: 'MappingTooLarge' });
  const type = /\.xlsx$/i.test(file.name) ? 'xlsx' : 'csv';
  const res = await fetch(`${BULK}/batches/${batchId}/mapping?type=${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  return json(res);
}

/** Sends a manual mapping: rows of { job_id, model_image, top_image, ... }. */
export async function saveManualMapping(batchId, rows) {
  const res = await fetch(`${BULK}/batches/${batchId}/mapping?type=json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  return json(res);
}

export async function fetchBatch(batchId) {
  return json(await fetch(`${BULK}/batches/${batchId}`));
}

export async function startBatch(batchId) {
  return json(await fetch(`${BULK}/batches/${batchId}/start`, { method: 'POST' }));
}

export async function regenerateJob(batchId, jobId, instruction) {
  return json(
    await fetch(`${BULK}/batches/${batchId}/jobs/${jobId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    })
  );
}
