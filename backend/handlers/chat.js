// Framework-agnostic request handlers — work with both Express (backend/server.js)
// and the Vite devApi() plugin (vite.config.js), which uses the same raw Node.js
// IncomingMessage / ServerResponse interface.
import { send } from '../../api/_auth.js';
import { chatTurn, enhanceRequest } from '../agents/chat.js';
import { jobStore } from '../metrics.js';
import { requireUser } from '../guard.js';

const MAX_BODY = 20 * 1024 * 1024; // chat requests carry base64 photos

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** POST /api/chat/turn */
export async function chatTurnHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const session = requireUser(req, res, 'chat');
  if (!session) return;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: 'OPENAI_API_KEY is not set on the server.' } });

  let input;
  try {
    input = JSON.parse((await rawBody(req)).toString());
  } catch (e) {
    return send(res, e.status === 413 ? 413 : 400, { error: { name: 'BadRequest', message: 'Invalid request body.' } });
  }

  const tStart = Date.now();
  try {
    const turn = await chatTurn({ ...input, openaiKey, photoMeta: input.photoMeta ?? {}, userId: session.username });
    const duration = Date.now() - tStart;
    jobStore.logRequest?.({ endpoint: 'openai/chat/turn', method: 'POST', status: 200, duration });
    send(res, 200, turn);
  } catch (e) {
    const status = e.status ?? 502;
    send(res, status, { error: { name: e.code ?? 'Error', message: e.message ?? 'Chat turn failed.' } });
  }
}

/** POST /api/chat/enhance */
export async function chatEnhanceHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!requireUser(req, res, 'chat')) return;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: 'OPENAI_API_KEY is not set.' } });

  let input;
  try {
    input = JSON.parse((await rawBody(req)).toString());
  } catch (e) {
    return send(res, e.status === 413 ? 413 : 400, { error: { name: 'BadRequest', message: 'Invalid request.' } });
  }

  try {
    const text = await enhanceRequest({ ...input, openaiKey });
    send(res, 200, { text });
  } catch (e) {
    send(res, e.status ?? 502, { error: { name: e.code ?? 'Error', message: e.message ?? 'Enhance failed.' } });
  }
}
