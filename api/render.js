import { makeProxy, FASHN_ALLOW } from './_proxy.js';

// /api/render/<path> -> the render service's API (vendor name kept server-side only)
// vercel.json rewrites /api/render/:path* to /api/render?path=:path*
export default makeProxy({ origin: 'https://api.fashn.ai', keyName: 'FASHN_API_KEY', allow: FASHN_ALLOW });
