import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { loginHandler, sessionHandler, logoutHandler, sessionFromReq, send, authConfigured } from './api/_auth.js';
import { FASHN_ALLOW, OPENAI_ALLOW } from './api/_proxy.js';
import { chatTurnHandler, chatEnhanceHandler } from './backend/handlers/chat.js';
import { agentJobHandler } from './backend/handlers/job.js';
import { photoAnalyzeHandler } from './backend/handlers/photo.js';

/**
 * Dev/preview version of the Vercel functions: serves /api/login|session|logout and refuses
 * /fashn and /openai calls without a session, so local behaves like production.
 */
function devApi() {
  const allowed = { '/api/render/': FASHN_ALLOW, '/api/assist/': OPENAI_ALLOW };
  const handle = (req, res, next) => {
    const [url] = req.url.split('?');
    if (url === '/api/login') return loginHandler(req, res);
    if (url === '/api/session') return sessionHandler(req, res);
    if (url === '/api/logout') return logoutHandler(req, res);
    if (url === '/api/chat/turn') return chatTurnHandler(req, res);
    if (url === '/api/chat/enhance') return chatEnhanceHandler(req, res);
    if (url === '/api/job/agent') return agentJobHandler(req, res);
    if (url === '/api/photo/analyze') return photoAnalyzeHandler(req, res);
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
  // All server-side handlers (auth, chat, job) read process.env at request time.
  // Inject every key the handlers need so devApi() works without a separate backend process.
  for (const k of ['APP_USERS', 'SESSION_SECRET', 'FASHN_API_KEY', 'OPENAI_API_KEY']) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }
  if (!authConfigured()) {
    console.warn('[auth] APP_USERS and/or SESSION_SECRET (32+ chars) are not set in .env. Sign-in will be unavailable. See .env.example.\n');
  }

  if (!env.FASHN_API_KEY) {
    console.warn('\n[fashn] FASHN_API_KEY is not set. Copy .env.example to .env and add your key.\n');
  }
  if (!env.OPENAI_API_KEY) {
    console.warn('[openai] OPENAI_API_KEY is not set. The "OpenAI image edit" workflow will be unavailable.\n');
  }

  // When BACKEND_PORT is set, route API calls through the local Express backend
  // (npm run server) which adds timing metrics. Otherwise proxy directly to external APIs.
  const backendPort = env.BACKEND_PORT;
  const backendOrigin = backendPort ? `http://localhost:${backendPort}` : null;

  const proxy = backendOrigin
    ? {
        // All API traffic goes through the Express backend.
        '/api/render': { target: backendOrigin, changeOrigin: false },
        '/api/assist': { target: backendOrigin, changeOrigin: false },
        '/cdn': { target: backendOrigin, changeOrigin: false },
        '/media': { target: backendOrigin, changeOrigin: false },
        '/api': { target: backendOrigin, changeOrigin: false },
      }
    : {
        '/api/render': {
          target: 'https://api.fashn.ai',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/render/, ''),
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
        '/api/assist': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/assist/, ''),
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}` },
        },
      };

  return {
    plugins: [react(), tailwindcss(), ...(backendOrigin ? [] : [devApi()])],
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
