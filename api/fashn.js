import { makeProxy, FASHN_ALLOW } from './_proxy.js';

// /fashn/<path> -> https://api.fashn.ai/<path>
// vercel.json rewrites /fashn/:path* to /api/fashn?path=:path* (a plain file name: catch-all
// "[...path].js" file names are a Next.js feature and are not routed in a Vite project).
export default makeProxy({ origin: 'https://api.fashn.ai', keyName: 'FASHN_API_KEY', allow: FASHN_ALLOW });
