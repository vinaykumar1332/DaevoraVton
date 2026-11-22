

// --- Auth ---
export const AUTH_LOGIN   = '/api/login';
export const AUTH_SESSION = '/api/session';
export const AUTH_LOGOUT  = '/api/logout';

// --- AI Chat (OpenAI logic lives on the server) ---
export const CHAT_TURN    = '/api/chat/turn';
export const CHAT_ENHANCE = '/api/chat/enhance';

// --- Image jobs ---
export const JOB_AGENT    = '/api/job/agent';

// --- Photo analysis ---
export const PHOTO_ANALYZE = '/api/photo/analyze';

// --- Result quality check ---
export const QUALITY_SCORE = '/api/quality/score';

// --- Render service proxy (Vite dev proxy / Vercel rewrite → api/render.js). Generic paths: no vendor names in the browser. ---
const RENDER = '/api/render';
export const FASHN_CREDITS       = `${RENDER}/v1/credits`;
export const FASHN_RUN           = `${RENDER}/v1/run`;
export const FASHN_STATUS        = (id) => `${RENDER}/v1/status/${encodeURIComponent(id)}`;
export const FASHN_AGENT_RUN     = `${RENDER}/v1/agent/images/run`;
export const FASHN_AGENT_STATUS  = (id) => `${RENDER}/v1/agent/status/${encodeURIComponent(id)}`;

// --- FASHN CDN passthrough (images served through this app to avoid CORS) ---
export const CDN_BASE   = '/cdn';
export const MEDIA_BASE = '/media';
export const CDN_ORIGINS = [
  { prefix: 'https://cdn.fashn.ai/',   route: CDN_BASE   + '/' },
  { prefix: 'https://media.fashn.ai/', route: MEDIA_BASE + '/' },
];
