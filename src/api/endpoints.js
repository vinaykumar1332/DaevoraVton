

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

// --- FASHN proxy (Vite dev proxy / Vercel rewrite → api/fashn.js) ---
export const FASHN_CREDITS       = '/fashn/v1/credits';
export const FASHN_RUN           = '/fashn/v1/run';
export const FASHN_STATUS        = (id) => `/fashn/v1/status/${encodeURIComponent(id)}`;
export const FASHN_AGENT_RUN     = '/fashn/v1/agent/images/run';
export const FASHN_AGENT_STATUS  = (id) => `/fashn/v1/agent/status/${encodeURIComponent(id)}`;

// --- OpenAI proxy (Vite dev proxy / Vercel rewrite → api/openai.js) ---
export const OPENAI_CHAT         = '/openai/v1/chat/completions';
export const OPENAI_IMAGE_EDIT   = '/openai/v1/images/edits';

// --- FASHN CDN passthrough (images served through this app to avoid CORS) ---
export const CDN_BASE   = '/cdn';
export const MEDIA_BASE = '/media';
export const CDN_ORIGINS = [
  { prefix: 'https://cdn.fashn.ai/',   route: CDN_BASE   + '/' },
  { prefix: 'https://media.fashn.ai/', route: MEDIA_BASE + '/' },
];
