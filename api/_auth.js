// Server-side sign-in, shared by the Vercel functions (api/*.js) and the Vite dev server (vite.config.js).
//
// Environment variables (server only, never VITE_-prefixed):
//   APP_USERS       JSON array: [{"username":"admin","password":"…","role":"admin","name":"Admin"}]
//   SESSION_SECRET  random string, 32+ characters. Signs the session cookie.
//
// The session is a signed, HttpOnly, SameSite=Strict cookie that expires after SESSION_HOURS.
// It is stateless: signing out clears the cookie, and a stolen cookie works until it expires.
import crypto from 'node:crypto';

export const COOKIE = 'vton_session';
export const SESSION_HOURS = 8;
const MAX_FAILS = 5; // per client IP ...
const FAIL_WINDOW_MS = 15 * 60 * 1000; // ... per 15 minutes (best effort: memory is per serverless instance)

/* ---------- small Node helpers (work for Vercel and Vite, no framework helpers needed) ---------- */

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function readBody(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      })
  );
}

const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';

/* ---------- configuration ---------- */

export function getUsers() {
  try {
    const list = JSON.parse(process.env.APP_USERS || '[]');
    return Array.isArray(list) ? list.filter((u) => u && u.username && u.password) : [];
  } catch {
    return [];
  }
}
const getSecret = () => {
  const s = process.env.SESSION_SECRET || '';
  return s.length >= 32 ? s : null;
};
export const authConfigured = () => getUsers().length > 0 && !!getSecret();

/* ---------- credentials + tokens ---------- */

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b)); // equal length digests, constant time

export function checkCredentials(username, password) {
  const name = String(username ?? '').trim();
  let found = null;
  for (const u of getUsers()) {
    // no early exit: every user is compared, so timing does not reveal which usernames exist
    const ok = safeEqual(u.username, name) & safeEqual(u.password, String(password ?? ''));
    if (ok) found = u;
  }
  return found ? { username: found.username, role: found.role || 'viewer', name: found.name || found.username } : null;
}

const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

export function createToken(session, now = Date.now()) {
  const secret = getSecret();
  const body = Buffer.from(JSON.stringify({ ...session, exp: now + SESSION_HOURS * 3600 * 1000 })).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token, now = Date.now()) {
  const secret = getSecret();
  if (!secret || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!(data.exp > now)) return null;
    return { username: data.username, role: data.role, name: data.name };
  } catch {
    return null;
  }
}

/** The signed-in user for a request, or null. */
export const sessionFromReq = (req) => verifyToken(parseCookies(req.headers.cookie)[COOKIE]);

function cookie(req, value, maxAge) {
  return [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`, isHttps(req) ? 'Secure' : ''].filter(Boolean).join('; ');
}

/* ---------- login rate limit ---------- */

const fails = new Map();
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
function recentFails(ip, now) {
  const list = (fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW_MS);
  fails.set(ip, list);
  return list;
}
export const resetRateLimit = () => fails.clear();

/* ---------- handlers ---------- */

export async function loginHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!authConfigured()) {
    return send(res, 503, { error: 'NotConfigured', message: 'Sign-in is not set up on the server (APP_USERS and SESSION_SECRET).' });
  }
  const ip = clientIp(req);
  const now = Date.now();
  const list = recentFails(ip, now);
  if (list.length >= MAX_FAILS) {
    const wait = Math.ceil((FAIL_WINDOW_MS - (now - list[0])) / 60000);
    return send(res, 429, { error: 'TooManyAttempts', message: `Too many attempts. Try again in ${wait} minute(s).` }, { 'Retry-After': String(wait * 60) });
  }

  let input;
  try {
    input = JSON.parse((await readBody(req)).toString() || '{}');
  } catch (e) {
    return send(res, e.status === 413 ? 413 : 400, { error: 'BadRequest', message: 'Invalid request' });
  }

  const user = checkCredentials(input.username, input.password);
  if (!user) {
    list.push(now);
    await new Promise((r) => setTimeout(r, 400)); // slows down guessing
    return send(res, 401, { error: 'InvalidCredentials', message: 'Incorrect username or password.' });
  }
  fails.delete(ip);
  send(res, 200, { user }, { 'Set-Cookie': cookie(req, createToken(user), SESSION_HOURS * 3600) });
}

export async function sessionHandler(req, res) {
  const user = sessionFromReq(req);
  if (!user) return send(res, 401, { error: 'NoSession' });
  send(res, 200, { user });
}

export async function logoutHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
}
