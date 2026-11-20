import { makeProxy, FASHN_ALLOW } from '../_proxy.js';

// /fashn/* -> https://api.fashn.ai/*  (vercel.json rewrites /fashn/:path* to this function)
export default makeProxy({ origin: 'https://api.fashn.ai', keyName: 'FASHN_API_KEY', allow: FASHN_ALLOW });
