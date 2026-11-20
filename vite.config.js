import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { loginHandler, sessionHandler, logoutHandler, sessionFromReq, send, authConfigured } from './api/_auth.js';
import { FASHN_ALLOW, OPENAI_ALLOW } from './api/_proxy.js';

/**
 * Dev/preview version of the Vercel functions: serves /api/login|session|logout and refuses
 * /fashn and /openai calls without a session, so local behaves like production.
 */
function devApi() {
  const allowed = { '/fashn/': FASHN_ALLOW, '/openai/': OPENAI_ALLOW };
  const handle = (req, res, next) => {
    const [url] = req.url.split('?');
    if (url === '/api/login') return loginHandler(req, res);
    if (url === '/api/session') return sessionHandler(req, res);
    if (url === '/api/logout') return logoutHandler(req, res);
    const prefix = Object.keys(allowed).find((p) => url.startsWith(p));
    if (!prefix) return next();
    if (!sessionFromReq(req)) {
      return send(res, 401, { error: { name: 'SessionExpired', message: 'Please sign in again.' } }, { 'X-Session-Expired': '1' });
    }
    const sub = url.slice(prefix.length);
    if (!allowed[prefix].some((a) => a.method === req.method && a.re.test(sub))) {
      return send(res, 403, { error: { name: 'Forbidden', message: 'This endpoint is not available.' } });
    }
    next();
  };
  return { name: 'dev-api', configureServer: (s) => void s.middlewares.use(handle), configurePreviewServer: (s) => void s.middlewares.use(handle) };
}

export default defineConfig(({ mode }) => {
  // Empty prefix => load ALL vars. They are only read here (Node side) and never
  // reach browser code, because only VITE_* variables are exposed to the client.
  const env = loadEnv(mode, process.cwd(), '');
  // The sign-in code reads process.env (same as on Vercel).
  for (const k of ['APP_USERS', 'SESSION_SECRET']) if (env[k] && !process.env[k]) process.env[k] = env[k];
  if (!authConfigured()) {
    console.warn('[auth] APP_USERS and/or SESSION_SECRET (32+ chars) are not set in .env. Sign-in will be unavailable. See .env.example.\n');
  }

  if (!env.FASHN_API_KEY) {
    console.warn('\n[fashn] FASHN_API_KEY is not set. Copy .env.example to .env and add your key.\n');
  }
  if (!env.OPENAI_API_KEY) {
    console.warn('[openai] OPENAI_API_KEY is not set. The "OpenAI image edit" workflow will be unavailable.\n');
  }

  const proxy = {
    '/fashn': {
      target: 'https://api.fashn.ai',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/fashn/, ''),
      headers: { Authorization: `Bearer ${env.FASHN_API_KEY ?? ''}` },
    },
    // Result images live on FASHN's CDN, which does not allow direct browser downloads (CORS).
    // These routes serve them from this app's own address so the app can save them.
    '/cdn': {
      target: 'https://cdn.fashn.ai',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/cdn/, ''),
    },
    '/media': {
      target: 'https://media.fashn.ai',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/media/, ''),
    },
    '/openai': {
      target: 'https://api.openai.com',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/openai/, ''),
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}` },
    },
  };

  return {
    plugins: [react(), tailwindcss(), devApi()],
    resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/__tests__/setup.js',
      css: false,
    },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
