import { makeProxy, OPENAI_ALLOW } from '../_proxy.js';

// /openai/* -> https://api.openai.com/*  (vercel.json rewrites /openai/:path* to this function)
export default makeProxy({ origin: 'https://api.openai.com', keyName: 'OPENAI_API_KEY', allow: OPENAI_ALLOW });
