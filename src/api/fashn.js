// FASHN API client + image utilities.
// All requests go to /fashn/* which the Vite dev/preview server proxies to
// https://api.fashn.ai/* and injects the Authorization header server-side.

const BASE = '/fashn';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

const HINTS = {
  BadRequest: 'The request was rejected — check images, prompt and settings.',
  Unauthorized: 'API key missing or invalid. Check FASHN_API_KEY in .env and restart the dev server.',
  UnauthorizedAccess: 'API key missing or invalid. Check FASHN_API_KEY in .env and restart the dev server.',
  NoImageGenerated: 'The model could not produce an image. Try a clearer prompt or different images.',
  ImageLoadError: 'An input image could not be loaded. Use a public URL or re-upload the file.',
  OutOfCredits: 'Not enough credits. Top up at app.fashn.ai.',
  RateLimit: 'Too many requests or not enough credits. Wait a moment / check your balance.',
  RateLimitExceeded: 'Rate limit hit (100 runs / 60 s, 50 status polls / 10 s). Wait a moment and retry.',
  ConcurrencyLimitExceeded: 'Too many jobs running at once (max 6). Wait for one to finish.',
  AgentTimeout: 'The agent ran >15 min without producing an image. Simplify the prompt, use "fast" mode or fewer outputs.',
  ContentModerationError: 'Blocked by content moderation. Change the images or prompt.',
  InputValidationError: 'An input failed validation — check image format (JPEG/PNG/WebP), size and settings.',
  ThirdPartyError: 'An upstream provider failed. Retry in a moment.',
  UnavailableError: 'The service is temporarily unavailable. Retry shortly.',
  PipelineError: 'Generation pipeline error. Retry, possibly with different inputs.',
  InternalServerError: 'FASHN server error. Retry shortly.',
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

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw toFashnError(data, res.status);
  return data;
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
  const data = await api('/v1/credits', { signal });
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
  const data = await api('/v1/agent/images/run', { method: 'POST', body, signal });
  if (!data?.id) throw toFashnError(data ?? 'No job id returned');
  return data.id;
}

export async function pollAgent(id, { signal, onUpdate, interval = 3000 } = {}) {
  for (;;) {
    const data = await api(`/v1/agent/status/${encodeURIComponent(id)}`, { signal });
    onUpdate?.(data);
    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw toFashnError(data.error ?? data);
    await sleep(interval, signal);
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
  const data = await api('/v1/run', {
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
    const data = await api(`/v1/status/${encodeURIComponent(id)}`, { signal });
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
export async function fileToJpegDataURI(file, { maxSide = 2048, quality = 0.92 } = {}) {
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
  if (url.startsWith('https://cdn.fashn.ai/')) return '/cdn/' + url.slice('https://cdn.fashn.ai/'.length);
  if (url.startsWith('https://media.fashn.ai/')) return '/media/' + url.slice('https://media.fashn.ai/'.length);
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
