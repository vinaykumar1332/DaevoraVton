// Framework-agnostic handler for starting FASHN agent jobs.
// Works with both Express (backend/server.js) and the Vite devApi() plugin.
import { send } from '../../api/_auth.js';
import { jobStore, logRequest } from '../metrics.js';
import { requireUser } from '../guard.js';

const MAX_BODY = 20 * 1024 * 1024; // up to 6 base64 photos

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

/** POST /api/job/agent — start a FASHN agent job, return {jobId}. */
export async function agentJobHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!requireUser(req, res, 'job')) return;
  const fashnKey = process.env.FASHN_API_KEY;
  if (!fashnKey) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: 'FASHN_API_KEY is not set.' } });

  let input;
  try {
    input = JSON.parse((await rawBody(req)).toString());
  } catch (e) {
    return send(res, e.status === 413 ? 413 : 400, { error: { name: 'BadRequest', message: 'Invalid request body.' } });
  }

  const { prompt, images, resolution = '1k', generation_mode = 'balanced', aspect_ratio } = input;
  if (!prompt || !Array.isArray(images) || !images.length) {
    return send(res, 400, { error: { name: 'BadRequest', message: 'prompt and images are required.' } });
  }

  const body = { prompt, images: images.slice(0, 6), resolution, generation_mode };
  if (aspect_ratio) body.aspect_ratio = aspect_ratio;

  const tStart = Date.now();
  try {
    const upstream = await fetch('https://api.fashn.ai/v1/agent/images/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fashnKey}` },
      body: JSON.stringify(body),
    });
    const duration = Date.now() - tStart;
    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const e = data?.error ?? data ?? {};
      const name = typeof e === 'string' ? e : e.name || e.code || '';
      const code = /^[A-Za-z]{3,40}$/.test(name) && !/openai|fashn/i.test(name) ? name : `Upstream${upstream.status}`;
      return send(res, upstream.status, { error: { name: code, message: 'The job could not be started. Try again.' } });
    }

    if (!data?.id) return send(res, 502, { error: { name: 'NoJobId', message: 'FASHN did not return a job id.' } });

    jobStore.start(data.id, 'v1/agent/images/run', tStart);
    logRequest({ endpoint: 'v1/agent/images/run', method: 'POST', status: upstream.status, duration });

    send(res, 200, { jobId: data.id });
  } catch (e) {
    send(res, 502, { error: { name: 'UnavailableError', message: 'FASHN service could not be reached.' } });
  }
}
