// Analyzes a single photo with GPT-4o Vision: returns role, type, color, fabric, view.
// Called immediately on upload so the chat turn already knows what each photo contains.
import { send } from '../../api/_auth.js';
import { requireUser } from '../guard.js';
import { upstreamCode } from '../agents/chat.js';

const MAX_BODY = 20 * 1024 * 1024;

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

const SYSTEM = `You are a fashion photo analyst. Look at the photo and return a JSON object describing what you see.

Fields:
- role: "model" (a person / mannequin) | "garment" | "shoes" | "accessory" | "background" | "other"
- type: specific item name, e.g. "saree", "t-shirt", "sneakers", "handbag", "blazer", "lehenga"
- color: dominant color(s), e.g. "deep red", "navy blue and white"
- fabric: fabric if visible, e.g. "silk", "denim", "cotton" — omit if unclear
- view: "front" | "back" | "side" | "three-quarter" | "flat-lay" | "unknown"
- worn: true if garment is on a person, false if flat-lay / hanger / packaged — only for garments
- logo: true if a logo, print or text is visible on the garment — only for garments
- pattern: the print or pattern, its scale and arrangement, e.g. "small navy florals on white, all-over" — only for garments
- details: embroidery, borders, buttons, zips, stitching or trims that are visible — only for garments
- logo_text: the exact text or logo name, only if readable — only for garments
- unclear: what you cannot see (e.g. "back not visible") — only for garments
- length: "upper" (top/shirt/jacket) | "lower" (trousers/skirt) | "full" (dress/saree/gown) — only for garments
- framing: "full" (head to feet visible) | "partial" — only for model photos
- person: "human" | "mannequin" — only for model photos
- gender: "woman" | "man" | "unknown" — only for model photos; judge only from what is visible, do not guess
- pose: "standing" | "sitting" | "walking" | "turned away" | "other" — only for model photos
- shot: "full_body" only when the head AND the feet are both visible | "cropped_head" when the body is visible to the feet but the head is cut off | "three_quarter" (knees up) | "half_body" (waist up) | "close_up" — only for model photos. Look for the top of the head: if it is out of frame, never use "full_body".
- sleeve: "sleeveless" | "short" | "long" | "none" — only for garments worn or shown on a body
- neckline: short description, e.g. "V-neck", "round", "halter" — only for garments
- style: short description of the cut, e.g. "A-line maxi with side slit", "straight-leg jeans" — only for garments
- notes: one short sentence of anything important not captured above (optional)

Reply with JSON only. Be concise. If uncertain, omit the field rather than guess.`;

/** POST /api/photo/analyze — { src: string (data URI or https URL) } → analysis object */
export async function photoAnalyzeHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!requireUser(req, res, 'photo')) return;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return send(res, 500, { error: { name: 'UnauthorizedAccess', message: 'OPENAI_API_KEY is not set.' } });

  let input;
  try {
    input = JSON.parse((await rawBody(req)).toString());
  } catch (e) {
    return send(res, e.status === 413 ? 413 : 400, { error: { name: 'BadRequest', message: 'Invalid request body.' } });
  }

  const { src } = input ?? {};
  if (!src || typeof src !== 'string') {
    return send(res, 400, { error: { name: 'BadRequest', message: 'src is required.' } });
  }
  // Only allow base64 image data URIs or HTTPS URLs from FASHN's CDN.
  // Reject arbitrary URLs to prevent using this endpoint as an SSRF proxy.
  const isDataUri = /^data:image\/(jpeg|png|webp|gif);base64,/.test(src);
  const isFashnCdn = /^https:\/\/(cdn|media)\.fashn\.ai\//.test(src);
  if (!isDataUri && !isFashnCdn) {
    return send(res, 400, { error: { name: 'BadRequest', message: 'src must be a base64 image data URI.' } });
  }
  if (src.length > 12 * 1024 * 1024) {
    return send(res, 413, { error: { name: 'PayloadTooLarge', message: 'Image is too large to analyze.' } });
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 450,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: src, detail: 'low' } }] },
        ],
      }),
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return send(res, upstream.status, { error: { name: upstreamCode(upstream.status), message: 'Analysis failed. Try again.' } });
    }

    let analysis = {};
    try {
      analysis = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
    } catch {}

    send(res, 200, analysis);
  } catch {
    send(res, 502, { error: { name: 'UnavailableError', message: 'OpenAI could not be reached.' } });
  }
}
