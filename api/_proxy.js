// Shared proxy for the Vercel functions api/fashn.js and api/openai.js. vercel.json rewrites
// /fashn/v1/credits to /api/fashn?path=v1/credits, so the API path arrives as the `path` query value.
// It does what the Vite dev proxy does locally: forwards the request to the real API and adds the
// secret key from an environment variable, so the key never reaches the browser.
//
// Protections:
//   - the caller must have a valid session cookie (api/_auth.js)
//   - only the endpoints the app uses are forwarded (allow-list), nothing else on the account
//   - OpenAI chat requests may only use the models the app uses
// Vercel limit: a function accepts a request body of up to 4.5 MB; the client downsizes photos for that.
import { send, sessionFromReq } from './_auth.js';

const MAX_BODY = 4.5 * 1024 * 1024;
export const OPENAI_CHAT_MODELS = ['gpt-4o'];

export const FASHN_ALLOW = [
  { method: 'GET', re: /^v1\/credits$/ },
  { method: 'POST', re: /^v1\/run$/ },
  { method: 'GET', re: /^v1\/status\/[\w-]+$/ },
  { method: 'POST', re: /^v1\/agent\/images\/run$/ },
  { method: 'GET', re: /^v1\/agent\/status\/[\w-]+$/ },
];
export const OPENAI_ALLOW = [
  { method: 'POST', re: /^v1\/chat\/completions$/ },
  { method: 'POST', re: /^v1\/images\/edits$/ },
];

/**
 * Upstream errors can name the provider and echo its internals. The browser gets only the status and a
 * generic code (the app maps those codes to friendly text), so no provider name leaves the server.
 */
async function sendUpstreamError(res, upstream) {
  const raw = await upstream.json().catch(() => null);
  const e = raw?.error ?? raw ?? {};
  const name = typeof e === 'string' ? e : e.name || e.code || e.type || '';
  const safe = /^[A-Za-z]{3,40}$/.test(name) && !/openai|fashn/i.test(name) ? name : `Upstream${upstream.status}`;
  return send(res, upstream.status, { error: { name: safe, message: 'The request could not be completed. Try again.' } });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {{ origin: string, keyName: string, allow: {method: string, re: RegExp}[] }} cfg
 *   origin   e.g. https://api.fashn.ai
 *   keyName  env var holding the API key, e.g. FASHN_API_KEY
 */
export function makeProxy({ origin, keyName, allow }) {
  return async function handler(req, res) {
    if (!sessionFromReq(req)) {
      return send(res, 401, { error: { name: 'SessionExpired', message: 'Please sign in again.' } }, { 'X-Session-Expired': '1' });
    }

    const key = process.env[keyName];
    if (!key) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: `${keyName} is not set in the server environment variables.` } });

    const { path, ...rest } = req.query ?? {};
    const subPath = (Array.isArray(path) ? path : [path]).filter(Boolean).join('/');
    if (!allow.some((a) => a.method === req.method && a.re.test(subPath))) {
      return send(res, 403, { error: { name: 'Forbidden', message: 'This endpoint is not available.' } });
    }

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(rest)) (Array.isArray(v) ? v : [v]).forEach((x) => qs.append(k, x));
    const url = `${origin}/${subPath}${qs.size ? `?${qs}` : ''}`;

    const headers = { Authorization: `Bearer ${key}` };
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

    try {
      let body;
      if (!['GET', 'HEAD'].includes(req.method)) {
        body = await readBody(req);
        if (keyName === 'OPENAI_API_KEY' && /json/.test(headers['Content-Type'] || '')) {
          let model;
          try {
            model = JSON.parse(body.toString()).model;
          } catch {
            return send(res, 400, { error: { name: 'BadRequest', message: 'Invalid JSON' } });
          }
          if (!OPENAI_CHAT_MODELS.includes(model)) {
            return send(res, 403, { error: { name: 'Forbidden', message: 'This model is not available.' } });
          }
        }
      }
      const upstream = await fetch(url, { method: req.method, headers, body });
      res.setHeader('Cache-Control', 'no-store');
      if (!upstream.ok) return sendUpstreamError(res, upstream);
      res.statusCode = upstream.status;
      const type = upstream.headers.get('content-type');
      if (type) res.setHeader('Content-Type', type);
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      if (e.status === 413) return send(res, 413, { error: { name: 'PayloadTooLarge', message: 'The photos are too large to send together.' } });
      send(res, 502, { error: { name: 'UnavailableError', message: 'The service could not be reached.' } });
    }
  };
}
