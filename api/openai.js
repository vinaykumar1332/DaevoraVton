import { makeProxy, OPENAI_ALLOW } from './_proxy.js';

// /openai/<path> -> https://api.openai.com/<path>
// vercel.json rewrites /openai/:path* to /api/openai?path=:path* (see api/fashn.js).
export default makeProxy({ origin: 'https://api.openai.com', keyName: 'OPENAI_API_KEY', allow: OPENAI_ALLOW });
