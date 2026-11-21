// Local Express backend for DaevoraVton.
// Proxies FASHN and OpenAI calls server-side (API keys never reach the browser) and
// records per-job timing to help diagnose generation duration.
//
// Usage:
//   npm run server         — start only the backend (port 3001)
//   npm run dev:full       — start frontend + backend together
//
// Set BACKEND_PORT in .env to use a different port.
// Set BACKEND_PORT in .env to activate backend mode in the Vite dev proxy.
import 'dotenv/config';
import express from 'express';
import { loginHandler, sessionHandler, logoutHandler, sessionFromReq, send } from '../api/_auth.js';
import { FASHN_ALLOW, OPENAI_ALLOW, OPENAI_CHAT_MODELS } from '../api/_proxy.js';
import { jobStore, logRequest } from './metrics.js';
import { chatTurnHandler, chatEnhanceHandler } from './handlers/chat.js';
import { agentJobHandler } from './handlers/job.js';
import { photoAnalyzeHandler } from './handlers/photo.js';
import { scoreLookHandler } from './handlers/score.js';

const PORT = Number(process.env.BACKEND_PORT ?? 3001);
const MAX_BODY = 4.5 * 1024 * 1024;

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function makeCdnProxy(origin, strip) {
  return async (req, res) => {
    const path = req.path.startsWith(strip) ? req.path.slice(strip.length) : req.path;
    try {
      const upstream = await fetch(origin + path);
      const type = upstream.headers.get('content-type');
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status);
      if (type) res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(buf);
    } catch {
      res.status(502).end();
    }
  };
}

const app = express();

// --- Auth ---
app.post('/api/login', loginHandler);
app.get('/api/session', sessionHandler);
app.post('/api/logout', logoutHandler);

// --- AI chat and prompt (backend owns all OpenAI logic) ---
app.post('/api/chat/turn', chatTurnHandler);
app.post('/api/chat/enhance', chatEnhanceHandler);

// --- Job management (backend starts FASHN jobs, client polls for real-time progress) ---
app.post('/api/job/agent', agentJobHandler);

// --- Photo analysis (GPT-4o Vision on upload, non-blocking) ---
app.post('/api/photo/analyze', photoAnalyzeHandler);
app.post('/api/quality/score', scoreLookHandler);

// --- Performance metrics ---
app.get('/api/metrics', (_req, res) => {
  res.json(jobStore.summary());
});

// --- FASHN proxy with timing ---
app.all('/api/render/*', async (req, res) => {
  if (!sessionFromReq(req)) {
    return send(res, 401, { error: { name: 'SessionExpired', message: 'Please sign in again.' } }, { 'X-Session-Expired': '1' });
  }
  const key = process.env.FASHN_API_KEY;
  if (!key) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: 'FASHN_API_KEY is not set.' } });

  const subPath = req.path.startsWith('/api/render/') ? req.path.slice('/api/render/'.length) : '';
  if (!FASHN_ALLOW.some((a) => a.method === req.method && a.re.test(subPath))) {
    return send(res, 403, { error: { name: 'Forbidden', message: 'This endpoint is not available.' } });
  }

  const headers = { Authorization: `Bearer ${key}` };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

  let body;
  const tStart = Date.now();
  try {
    if (!['GET', 'HEAD'].includes(req.method)) body = await rawBody(req);
  } catch (e) {
    return e.status === 413
      ? send(res, 413, { error: { name: 'PayloadTooLarge', message: 'Photos too large.' } })
      : send(res, 400, { error: { name: 'BadRequest', message: 'Could not read request.' } });
  }

  try {
    const upstream = await fetch(`https://api.fashn.ai/${subPath}`, { method: req.method, headers, body });
    const duration = Date.now() - tStart;
    const type = upstream.headers.get('content-type');
    const buf = Buffer.from(await upstream.arrayBuffer());

    // Track job start
    if (/^v1\/(run|agent\/images\/run)$/.test(subPath)) {
      try {
        const { id } = JSON.parse(buf.toString());
        if (id) jobStore.start(id, subPath, tStart);
      } catch {}
    }
    // Track poll results (status updates let us see queue vs generation time)
    if (/^v1\/(status|agent\/status)\//.test(subPath)) {
      try {
        const parsed = JSON.parse(buf.toString());
        const jobId = req.path.split('/').pop();
        jobStore.poll(jobId, parsed.status, duration);
      } catch {}
    }
    logRequest({ endpoint: subPath, method: req.method, status: upstream.status, duration });

    res.status(upstream.status);
    if (type) res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch {
    send(res, 502, { error: { name: 'UnavailableError', message: 'FASHN service could not be reached.' } });
  }
});

// --- OpenAI proxy with timing ---
app.all('/api/assist/*', async (req, res) => {
  if (!sessionFromReq(req)) {
    return send(res, 401, { error: { name: 'SessionExpired', message: 'Please sign in again.' } }, { 'X-Session-Expired': '1' });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: 'OPENAI_API_KEY is not set.' } });

  const subPath = req.path.startsWith('/api/assist/') ? req.path.slice('/api/assist/'.length) : '';
  if (!OPENAI_ALLOW.some((a) => a.method === req.method && a.re.test(subPath))) {
    return send(res, 403, { error: { name: 'Forbidden', message: 'This endpoint is not available.' } });
  }

  const headers = { Authorization: `Bearer ${key}` };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

  let body;
  const tStart = Date.now();
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      body = await rawBody(req);
      // Model allow-list for chat completions only (image edits are multipart)
      if (subPath === 'v1/chat/completions' && /json/.test(req.headers['content-type'] ?? '')) {
        const { model } = JSON.parse(body.toString());
        if (!OPENAI_CHAT_MODELS.includes(model)) {
          return send(res, 403, { error: { name: 'Forbidden', message: 'This model is not available.' } });
        }
      }
    }
  } catch (e) {
    return e.status === 413
      ? send(res, 413, { error: { name: 'PayloadTooLarge', message: 'Request too large.' } })
      : send(res, 400, { error: { name: 'BadRequest', message: 'Could not read request.' } });
  }

  try {
    const upstream = await fetch(`https://api.openai.com/${subPath}`, { method: req.method, headers, body });
    const duration = Date.now() - tStart;
    const type = upstream.headers.get('content-type');
    const buf = Buffer.from(await upstream.arrayBuffer());
    logRequest({ endpoint: `openai/${subPath}`, method: req.method, status: upstream.status, duration });
    res.status(upstream.status);
    if (type) res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch {
    send(res, 502, { error: { name: 'UnavailableError', message: 'OpenAI could not be reached.' } });
  }
});

// --- FASHN CDN passthrough (no auth; images are not sensitive) ---
app.get('/cdn/*', makeCdnProxy('https://cdn.fashn.ai', '/cdn'));
app.get('/media/*', makeCdnProxy('https://media.fashn.ai', '/media'));

app.listen(PORT, () => {
  console.log(`[backend] Running at http://localhost:${PORT}`);
  console.log(`[backend] Metrics at http://localhost:${PORT}/api/metrics`);
  if (!process.env.FASHN_API_KEY) console.warn('[backend] Warning: FASHN_API_KEY is not set');
  if (!process.env.OPENAI_API_KEY) console.warn('[backend] Warning: OPENAI_API_KEY is not set');
});
