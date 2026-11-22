// Render client + image utilities. Requests go to /api/render/* (see endpoints.js); the server
// forwards them with its own credentials, so the browser never sees a key or a provider name.
import { FASHN_CREDITS, FASHN_RUN, FASHN_STATUS, FASHN_AGENT_RUN, FASHN_AGENT_STATUS, CDN_ORIGINS } from './endpoints.js';
import { fitPayload } from '@/lib/imageShrink.js';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

const HINTS = {
  BadRequest: 'The request was rejected — check images, prompt and settings.',
  Unauthorized: 'The service is not connected. Ask the admin to check the settings.',
  UnauthorizedAccess: 'The service is not connected. Ask the admin to check the settings.',
  NoImageGenerated: 'The model could not produce an image. Try a clearer prompt or different images.',
  ImageLoadError: 'An input image could not be loaded. Use a public URL or re-upload the file.',
  OutOfCredits: 'Not enough credits. Top up your credits, then try again.',
  RateLimit: 'Too many requests or not enough credits. Wait a moment / check your balance.',
  RateLimitExceeded: 'Rate limit hit (100 runs / 60 s, 50 status polls / 10 s). Wait a moment and retry.',
  ConcurrencyLimitExceeded: 'Too many jobs running at once (max 6). Wait for one to finish.',
  AgentTimeout: 'The agent ran >15 min without producing an image. Simplify the prompt, use "fast" mode or fewer outputs.',
  ContentModerationError: 'Blocked by content moderation. Change the images or prompt.',
  InputValidationError: 'An input failed validation — check image format (JPEG/PNG/WebP), size and settings.',
  ThirdPartyError: 'An upstream provider failed. Retry in a moment.',
  UnavailableError: 'The service is temporarily unavailable. Retry shortly.',
  PipelineError: 'Generation pipeline error. Retry, possibly with different inputs.',
  InternalServerError: 'The service had an error. Retry shortly.',
  NotFound: 'Job not found (expired or belongs to another key).',
  Canceled: 'The job was canceled.',
};

export class FashnError extends Error {
  constructor({ status = null, code = 'Error', message = '', raw = null }) {
    super(message || HINTS[code] || code);
    this.name = 'FashnError';
    this.status = status;
    this.code = code;
    this.hint = HINTS[code] || null;
    this.raw = raw;
  }
}

const CODE_STATUS = {
  BadRequest: 400,
  UnauthorizedAccess: 401,
  NotFound: 404,
  RateLimitExceeded: 429,
  ConcurrencyLimitExceeded: 429,
  OutOfCredits: 429,
  NoImageGenerated: 422,
  ImageLoadError: 422,
  ContentModerationError: 422,
  InputValidationError: 422,
  AgentTimeout: 504,
  InternalServerError: 500,
};

/* ------------------------------------------------------------------ */
/* Credit cost tables (docs.fashn.ai, per output image)                */
/* ------------------------------------------------------------------ */

const AGENT_COST = {
  fast: { '1k': 1, '2k': 1, '3k': 1, '4k': 1 },
  balanced: { '1k': 1, '2k': 2, '3k': 3, '4k': 3 },
  quality: { '1k': 2, '2k': 3, '3k': 4, '4k': 4 },
};
const TRYON_COST = {
  fast: { '1k': 1, '2k': 2, '4k': 3 },
  balanced: { '1k': 2, '2k': 3, '4k': 4 },
  quality: { '1k': 3, '2k': 4, '4k': 5 },
};

/** Credits per generated image for the Agent (upscale / bg-remove ops add 1 each). */
export const agentCostPerImage = (mode, res) => AGENT_COST[mode]?.[res] ?? null;
/** Total credits for a Try-On Max run. */
export const tryonCost = (mode, res, n = 1) => (TRYON_COST[mode]?.[res] ?? 0) * n;

function defaultCode(status) {
  if (status === 400) return 'BadRequest';
  if (status === 401 || status === 403) return 'Unauthorized';
  if (status === 422) return 'NoImageGenerated';
  if (status === 429) return 'RateLimit';
  if (status === 504) return 'AgentTimeout';
  return status ? `HTTP${status}` : 'Error';
}

/** Turn any FASHN error payload shape into a FashnError. */
export function toFashnError(payload, status = null) {
  let code;
  let message;
  if (payload && typeof payload === 'object') {
    const e = payload.error ?? payload;
    if (typeof e === 'string') {
      code = e;
      message = payload.message;
    } else if (e && typeof e === 'object') {
      code = e.name || e.code || e.type;
      message = e.message || e.detail;
    }
    message = message || payload.message || payload.detail;
    if (typeof message === 'object') message = JSON.stringify(message);
  } else if (typeof payload === 'string' && payload.trim()) {
    message = payload.slice(0, 300);
  }
  code = code || defaultCode(status);
  return new FashnError({ status: status ?? CODE_STATUS[code] ?? null, code, message, raw: payload });
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

// Reads (GET) are retried on rate limits and server errors: waits of 1 s, 2 s, then 4 s, then stop.
// Starting a job (POST) is never retried automatically, so a retry cannot start a second paid job.
export const RETRY_DELAYS_MS = [1000, 2000, 4000];
export const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 20000;

export function shouldRetry({ method, status, attempt }) {
  return method === 'GET' && RETRY_STATUSES.has(status) && attempt < RETRY_DELAYS_MS.length;
}

async function fetchOnce(path, { method, body, signal }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(await fitPayload(body)) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { res, data };
  } catch (err) {
    if (signal?.aborted) throw err;
    if (controller.signal.aborted) throw Object.assign(new Error('The request took too long.'), { code: 'AgentTimeout' });
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    const { res, data } = await fetchOnce(path, { method, body, signal });
    if (res.ok) return data;
    if (shouldRetry({ method, status: res.status, attempt })) {
      await sleep(RETRY_DELAYS_MS[attempt], signal);
      continue;
    }
    throw toFashnError(data, res.status);
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/* ------------------------------------------------------------------ */
/* Credits                                                             */
/* ------------------------------------------------------------------ */

export async function getCredits(signal) {
  const data = await api(FASHN_CREDITS, { signal });
  const c = data?.credits ?? data;
  if (typeof c === 'number') return { total: c, raw: data };
  return {
    total: c?.total ?? c?.balance ?? null,
    subscription: c?.subscription ?? null,
    onDemand: c?.on_demand ?? null,
    raw: data,
  };
}

/* ------------------------------------------------------------------ */
/* Agent Images                                                        */
/* ------------------------------------------------------------------ */

export async function runAgent({ prompt, images, resolution, generation_mode, aspect_ratio }, signal) {
  const body = { prompt, images: images.slice(0, 6), resolution, generation_mode };
  if (aspect_ratio) body.aspect_ratio = aspect_ratio;
  const data = await api(FASHN_AGENT_RUN, { method: 'POST', body, signal });
  if (!data?.id) throw toFashnError(data ?? 'No job id returned');
  return data.id;
}

// Every 3 s for the first minute, then every 5 s; give up after 6 minutes.
export const POLL_SCHEDULE = { fastMs: 3000, slowMs: 5000, fastWindowMs: 60000, limitMs: 6 * 60000 };

export async function pollAgent(id, { signal, onUpdate, schedule = POLL_SCHEDULE } = {}) {
  const started = Date.now();
  for (;;) {
    const data = await api(FASHN_AGENT_STATUS(id), { signal });
    onUpdate?.(data);
    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw toFashnError(data.error ?? data);
    const elapsed = Date.now() - started;
    if (elapsed >= schedule.limitMs) throw Object.assign(new Error('Took too long'), { code: 'AgentTimeout' });
    await sleep(elapsed < schedule.fastWindowMs ? schedule.fastMs : schedule.slowMs, signal);
  }
}

function resultUrl(r) {
  if (typeof r === 'string') return r;
  return r?.url || r?.image || r?.image_url || r?.output || null;
}

/** Extract images / tools / credits from a completed agent status payload. */
export function extractAgentResults(data) {
  const preds = Array.isArray(data.predictions) ? data.predictions : [];
  const images = [];
  const tools = [];
  for (const p of preds) {
    if (p.tool) tools.push({ tool: p.tool, status: p.status });
    if (p.status !== 'completed') continue;
    for (const r of p.results ?? []) {
      const u = resultUrl(r);
      if (u) images.push(u);
    }
  }
  return { images, tools, creditsUsed: data.credits_used ?? null };
}

/* ------------------------------------------------------------------ */
/* Try-On Max                                                          */
/* ------------------------------------------------------------------ */

export async function runTryOn(inputs, signal) {
  const clean = { output_format: 'png', ...inputs };
  if (!clean.prompt) delete clean.prompt;
  const data = await api(FASHN_RUN, {
    method: 'POST',
    body: { model_name: 'tryon-max', inputs: clean },
    signal,
  });
  if (data?.error) throw toFashnError(data);
  if (!data?.id) throw toFashnError(data ?? 'No job id returned');
  return data.id;
}

export async function pollTryOn(id, { signal, onUpdate, interval = 2000 } = {}) {
  for (;;) {
    const data = await api(FASHN_STATUS(id), { signal });
    onUpdate?.(data);
    if (data.status === 'completed') return data;
    if (data.status === 'failed' || data.status === 'canceled') {
      throw toFashnError(data.error ?? { error: data.status === 'canceled' ? 'Canceled' : 'Failed' });
    }
    await sleep(interval, signal);
  }
}

/* ------------------------------------------------------------------ */
/* Image utils                                                         */
/* ------------------------------------------------------------------ */

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image "${file.name}"`));
    };
    img.src = url;
  });
}

/**
 * Downscale to `maxSide` on the longest side and encode as JPEG data URI
 * on a white background (flattens transparent PNGs).
 */
export async function fileToJpegDataURI(file, { maxSide = 1600, quality = 0.85 } = {}) {
  const img = await loadImageFromFile(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { dataURI: canvas.toDataURL('image/jpeg', quality), width: w, height: h, originalWidth: w0, originalHeight: h0 };
}

export function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Download via fetch -> blob -> <a download>. Falls back to opening in a new tab if CORS blocks it. */
/** Maps FASHN CDN links to this app's own /cdn and /media routes (see vite.config.js). */
export function proxiedUrl(url) {
  for (const { prefix, route } of CDN_ORIGINS) {
    if (url.startsWith(prefix)) return route + url.slice(prefix.length);
  }
  return url;
}

export async function downloadImage(url, filename) {
  try {
    const res = await fetch(proxiedUrl(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener');
    return false;
  }
}
