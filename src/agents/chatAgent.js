// Chat turn for the AI Studio: OpenAI talks with the user, asks follow-up questions when
// needed, and decides when to create an image (and which photos + prompt to send to FASHN).
import { FashnError } from '@/api/fashn.js';
import { normalizeNotes, normalizeView } from '@/agents/studioPrompt.js';

const SYSTEM = `You are a friendly fashion styling assistant inside a virtual try-on studio. You chat with the user.
The user can send text and photos. Photos are shown to you labelled "photo N" (N is their position in this session).
Photos marked NEW were sent in the latest message. They are the user's current inputs.

Your job:
1. Understand what the user wants: a model wearing garments (top, bottom, dress), shoes or accessories, a background, or a change to the previous result.
2. If something important is missing, ask ONE short question. Never ask more than one question at a time.
3. When you have enough, set "generate": true and write a detailed "prompt" for an image engine. The engine receives images in this order: first the previous result (only if use_previous is true), then the photos listed in use_photos, in that same order. Refer to them as "image 1", "image 2", … in that order. Describe garment details precisely (colour, fabric, print, fit, length). Say what must stay unchanged (face, pose, body, background unless a change is asked).
4. Use use_previous: true ONLY when the user asks to change, adjust or continue the previous result AND sends no new photos. If NEW photos are sent, build the look from those photos (and earlier photos the user refers to), not from the previous result.
   The prompt must describe ONLY what is in the images you use. Never carry over garments, colours or people from earlier turns or the previous prompt unless the user asks for them (a new shirt and a new man means a man in that shirt, nothing from an earlier saree look).
5. Keep "reply" short, warm and plain (1 to 3 sentences). Never mention APIs, models, prompts or JSON. When you generate, say you are creating the look now.
6. Two requests have their own dedicated tools. Never use "generate" for them:
   - Only a sharper / bigger / higher-resolution / HD / 2K-4K version of an image, with nothing else changed: action "upscale". Set "resolution" to "2k", "3k" or "4k" (default "4k").
   - Only removing the background / a transparent cut-out: action "remove_background".
   For both, set "target_photo" to the photo number to use, or null to use the previous result. If the user also asks for other changes, use "generate" instead.
7. When you generate, look closely at every photo you use and fill "photo_notes": one entry per used photo with its "role" (model, garment, shoes, accessory, background, other) and the "view" it shows (front, back, side, three-quarter, flat-lay, unknown). For a person, "view" is which way their body faces the camera; for a garment, which side of the garment is visible.
   Also add, when they apply: for a garment, "worn": true if it is shown on a person (a shop or catalogue photo), and "length": "upper" (top, shirt, blouse, jacket), "lower" (trousers, skirt) or "full" (dress, saree, lehenga, gown, jumpsuit); for the model, "framing": "full" if head to feet is visible, otherwise "partial".
   Users send all kinds of photos. Judge each one from what you actually see, not from the order or the file name.
   Set "output_view" to the view of the final image: the model photo's pose unless the user asks for another view.
   If the pose faces away (back or side) and you only have the front of the garment, still generate: say in "reply" that you will match the back to the fabric and that a photo of the garment's back gives exact details.

Reply with JSON only:
{"reply": string, "action": "reply" | "generate" | "upscale" | "remove_background", "prompt": string, "use_photos": number[], "use_previous": boolean, "resolution": string, "target_photo": number | null, "photo_notes": [{"photo": number, "role": string, "view": string, "worn"?: boolean, "length"?: string, "framing"?: string}], "output_view": "front" | "back" | "side" | "three-quarter"}
For "reply", "upscale" and "remove_background", use an empty prompt, an empty use_photos array, use_previous false and an empty photo_notes array. Use at most 5 photos.`;

/**
 * history:   [{role:'user'|'assistant', content: string}] (text only)
 * photos:    [{src}] all session photos, in order
 * newCount:  how many of the last photos were sent in this message
 */
/** Rewrites a short request into a clear, specific one. Keeps the user's intent. */
export async function enhanceRequest({ text, photoCount, signal }) {
  const res = await fetch('/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You improve requests for a fashion try-on studio. Rewrite the request as one clear, specific instruction: name the garments, colours and fabrics that are mentioned, the framing, pose and background. Keep the user\'s intent. Do not add items they did not ask for. Keep it under 60 words. Reply with JSON only: {"text": string}.',
        },
        { role: 'user', content: `Photos attached to the studio: ${photoCount}.\nRequest: ${text}` },
      ],
    }),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new FashnError({ status: res.status, code: e.code || e.type || `OpenAI${res.status}`, message: e.message || res.statusText });
  }
  let parsed = {};
  try {
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
  } catch {
    parsed = {};
  }
  return String(parsed.text ?? '').trim().slice(0, 600) || text;
}

export async function chatTurn({ history, userText, photos, newCount = 0, lastPrompt, hasPrevious, signal }) {
  const recent = photos.slice(-8);
  const offset = photos.length - recent.length;
  const firstNew = photos.length - newCount + 1; // 1-based number of the first NEW photo

  const intro =
    `Photos in this session: ${photos.length ? photos.map((_, i) => `photo ${i + 1}`).join(', ') : 'none yet'}.` +
    (newCount ? ` NEW in this message: ${newCount === 1 ? `photo ${firstNew}` : `photos ${firstNew}–${photos.length}`}.` : ' No new photos in this message.') +
    (hasPrevious ? ' A previous result exists.' : ' No previous result yet.') +
    (lastPrompt ? `\nPrevious prompt: ${lastPrompt}` : '');

  const content = [{ type: 'text', text: intro }];
  recent.forEach((p, i) => {
    const n = offset + i + 1;
    content.push({ type: 'text', text: `photo ${n}${n >= firstNew ? ' (NEW)' : ''}:` });
    content.push({ type: 'image_url', image_url: { url: p.src, detail: 'high' } });
  });
  content.push({ type: 'text', text: `User says: ${userText || '(sent photos only)'}` });

  const res = await fetch('/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content }],
    }),
    signal,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new FashnError({
      status: res.status,
      code: e.code || e.type || `OpenAI${res.status}`,
      message: e.message || res.statusText,
      raw: data,
    });
  }

  let parsed = {};
  try {
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
  } catch {
    parsed = {};
  }

  const n = photos.length;
  const validIdx = (Array.isArray(parsed.use_photos) ? parsed.use_photos : [])
    .map(Number)
    .filter((x) => Number.isInteger(x) && x >= 1 && x <= n)
    .slice(0, 5);

  // Guardrails: new photos in this message are always used, and the old result is not reused by accident.
  const newIdx = Array.from({ length: newCount }, (_, i) => firstNew + i).slice(0, 5);
  const usePhotos = validIdx.length ? validIdx : newIdx;
  const useNew = newCount > 0;
  const usePrevious = !!parsed.use_previous && !!hasPrevious && !useNew;

  const prompt = String(parsed.prompt ?? '').slice(0, 10000);
  return {
    reply: String(parsed.reply ?? '').slice(0, 600) || 'Tell me a bit more about the look you want.',
    ...normalizeAction(parsed, { photoCount: n, newCount, firstNew, prompt }),
    prompt,
    use_photos: usePhotos,
    use_previous: usePrevious,
    photo_notes: normalizeNotes(parsed.photo_notes, n),
    output_view: normalizeView(parsed.output_view),
  };
}

/**
 * Turns the model's action fields into a safe, complete shape.
 * Tools need an image: target_photo (1-based) if valid, else the first NEW photo, else null (= previous result).
 */
export function normalizeAction(parsed, { photoCount, newCount, firstNew, prompt }) {
  const known = ['reply', 'generate', 'upscale', 'remove_background'];
  let action = known.includes(parsed.action) ? parsed.action : parsed.generate ? 'generate' : 'reply';
  if (action === 'generate' && !prompt) action = 'reply';

  const t = Number(parsed.target_photo);
  const targetPhoto = Number.isInteger(t) && t >= 1 && t <= photoCount ? t : newCount > 0 ? firstNew : null;
  const resolution = ['2k', '3k', '4k'].includes(parsed.resolution) ? parsed.resolution : '4k';
  return { action, generate: action === 'generate', target_photo: targetPhoto, resolution };
}
