import { makeProxy, OPENAI_ALLOW } from './_proxy.js';

// /api/assist/<path> -> the assist service's API (vendor name kept server-side only)
// vercel.json rewrites /api/assist/:path* to /api/assist?path=:path*
export default makeProxy({ origin: 'https://api.openai.com', keyName: 'OPENAI_API_KEY', allow: OPENAI_ALLOW });
