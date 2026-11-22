// Quality check for a finished look: compares the output with its input photos and the request.
// The score is an automatic estimate from a vision model, so the UI presents it as a check, not a fact.
import { send } from '../../api/_auth.js';
import { requireUser } from '../guard.js';
import { upstreamCode } from '../agents/chat.js';
import { passes } from '../../src/agents/qualityGate.js';

const MAX_BODY = 25 * 1024 * 1024;
const MAX_INPUTS = 6;
const MAX_TEXT = 1200;
const DATA_URI = /^data:image\/(jpeg|png|webp|gif);base64,/;
const FASHN_CDN = /^https:\/\/(cdn|media)\.fashn\.ai\//;

export const AREAS = ['pose', 'garment', 'face', 'colour', 'background', 'accessories'];
const SOURCES = ['output', 'analysis', 'request'];

const SYSTEM = `You are a quality checker for a fashion try-on image. The first images are the inputs: the person, the garment and any reference photos. The last image is the generated result. You also get the request and the brief that was sent to the image engine.
Score each area from 0 to 100 by comparing the result with the inputs and the request:
- pose: the body position the request asks for; without a requested change, the pose of the model photo. Check arms and hands.
- garment: colour, fabric, print, cut, length and fit as in the garment photo.
- face: the same person's face, expression, skin tone and hair.
- colour: colours true to the photos, with no colour shift.
- background: the background and lighting the request asks for.
- accessories: accessories the person wore are still there, and nothing extra was added.
List the specific problems you find, at most 5. For each one give "area", "source" and a short plain sentence in "detail". Use "source": "output" when the result itself is wrong compared with the inputs; "analysis" when the photos were misread, for example the garment or person described wrongly; "request" when the request or brief asked for something that was not followed or conflicts with the photos. Leave out areas that are fine.
Reply with JSON only: {"areas": {"pose": int, "garment": int, "face": int, "colour": int, "background": int, "accessories": int}, "problems": [{"area": string, "source": string, "detail": string}]}.`;

const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));

/** Turns the model's reply into { match, areas, problems }, or null when it has no usable scores. */
export function summarize(text) {
  let data = {};
  try {
    data = JSON.parse(text ?? '{}');
  } catch {}
  const areas = {};
  for (const a of AREAS) {
    const n = Number(data.areas?.[a]);
    if (Number.isFinite(n)) areas[a] = clamp(n);
  }
  const values = Object.values(areas);
  if (!values.length) return null;
  const match = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  const pass = passes(areas, match);
  const problems = (Array.isArray(data.problems) ? data.problems : [])
    .filter((p) => AREAS.includes(p?.area) && typeof p.detail === 'string' && p.detail.trim())
    .slice(0, 5)
    .map((p) => ({
      area: p.area,
      source: SOURCES.includes(p.source) ? p.source : 'output',
      detail: p.detail.replace(/[\r\n]+/g, ' ').trim().slice(0, 180),
    }));
  return { match, areas, problems, pass };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

/** POST /api/quality/score — { inputs, output, request?, brief? } → { match, areas, problems } */
export async function scoreLookHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!requireUser(req, res, 'score')) return;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: 'OPENAI_API_KEY is not set.' } });

  let input;
  try {
    input = await readJson(req);
  } catch (e) {
    return send(res, e.status === 413 ? 413 : 400, { error: { name: 'BadRequest', message: 'Invalid request body.' } });
  }

  const { inputs, output, request, brief } = input ?? {};
  const allowedInput = (s) => typeof s === 'string' && (DATA_URI.test(s) || FASHN_CDN.test(s));
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_INPUTS || !inputs.every(allowedInput)) {
    return send(res, 400, { error: { name: 'BadRequest', message: 'inputs must be 1 to 6 photos.' } });
  }
  if (typeof output !== 'string' || !FASHN_CDN.test(output)) {
    return send(res, 400, { error: { name: 'BadRequest', message: 'output must be a result image.' } });
  }

  const image = (url, detail = 'low') => ({ type: 'image_url', image_url: { url, detail } });
  const roles = Array.isArray(input?.inputRoles) ? input.inputRoles : [];
  const content = [
    ...inputs.map((url, i) => image(url, roles[i] === 'garment' ? 'high' : 'low')),
    image(output, 'high'),
    {
      type: 'text',
      text: `The user asked for: ${String(request ?? '').slice(0, MAX_TEXT)}\nThe brief sent to the engine: ${String(brief ?? '').slice(0, MAX_TEXT)}`,
    },
  ];

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content },
        ],
      }),
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return send(res, upstream.status, { error: { name: upstreamCode(upstream.status), message: 'Quality check failed. Try again.' } });
    }
    const result = summarize(data?.choices?.[0]?.message?.content);
    if (!result) return send(res, 502, { error: { name: 'NoScore', message: 'No quality result was returned.' } });
    send(res, 200, result);
  } catch {
    send(res, 502, { error: { name: 'UnavailableError', message: 'OpenAI could not be reached.' } });
  }
}
