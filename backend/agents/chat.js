// Server-side chat turn: OpenAI decides what to do (generate, reply, upscale, remove_background),
// then buildPrompt adds the house rules and view corrections. Returns the full turn including enginePrompt.
// Calls OpenAI directly — no proxy needed on the backend.
import { normalizeNotes, normalizeView, normalizeStyling, buildPrompt } from './prompt.js';
import { TURN_RESPONSE_FORMAT, parseTurnReply } from '../../src/agents/schema.js';
import { mergePhotoFacts, applyRoleOverrides } from '../../src/agents/photoFacts.js';
import { selectImages } from '../../src/agents/imageBudget.js';
import { preflight } from '../../src/agents/preflight.js';
import { logTurn } from '../logTurn.js';

/** Generic code for an upstream failure: no provider name reaches the browser. */
export const upstreamCode = (status) => (status === 429 ? 'RateLimit' : `Upstream${status}`);

class ApiError extends Error {
  constructor({ status = null, code = 'Error', message = '' }) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const SYSTEM = `You are a friendly fashion styling assistant inside a virtual try-on studio. You chat with the user.
The user can send text and photos. Photos are shown to you labelled "photo N" (N is their position in this session).
Photos marked NEW were sent in the latest message. They are the user's current inputs.

Your job:
1. Understand what the user wants: a model wearing garments (top, bottom, dress), shoes or accessories, a background, or a change to the previous result.
2. If something important is missing, ask ONE short question. Never ask more than one question at a time.
3. When you have enough, set "generate": true and write a detailed "prompt" for an image engine. The engine receives images in this order: first the previous result (only if use_previous is true), then the photos listed in use_photos, in that same order. Refer to them as "image 1", "image 2", … in that order. Describe garment details precisely (colour, fabric, print, fit, length). Say what must stay unchanged (face, pose, body, background unless a change is asked).
4. Use use_previous: true when the user asks to change, adjust or continue the previous result, even if they also send NEW photos. Example: a previous result plus new shoes and "add these shoes to the previous image" means use_previous true, with the new shoes as the reference. Use use_previous false when the user wants a completely new look (for example a new model and a new dress): then build it only from the photos sent.
   The prompt must describe ONLY what is in the images you use. Never carry over garments, colours or people from earlier turns or the previous prompt unless the user asks for them (a new shirt and a new man means a man in that shirt, nothing from an earlier saree look).
5. Keep "reply" short, warm and plain (1 to 3 sentences). Never mention APIs, models, prompts or JSON. When you generate, say you are creating the look now.
6. Two requests have their own dedicated tools. Never use "generate" for them:
   - Only a sharper / bigger / higher-resolution / HD / 2K-4K version of an image, with nothing else changed: action "upscale". Set "resolution" to "2k", "3k" or "4k" (default "4k").
   - Only removing the background / a transparent cut-out: action "remove_background".
   For both, set "target_photo" to the photo number to use, or null to use the previous result. If the user also asks for other changes, use "generate" instead.
7. When you generate, look closely at every photo you use and fill "photo_notes": one entry per used photo with its "role" (model, garment, shoes, accessory, background, logo, pose, other). A photo sent as a pose reference gets role "pose" and the "view" it shows (front, back, side, three-quarter, flat-lay, unknown). For a person, "view" is which way their body faces the camera; for a garment, which side of the garment is visible.
   Also add, when they apply: for a garment, "worn": true if it is shown on a person (a shop or catalogue photo), and "length": "upper" (top, shirt, blouse, jacket), "lower" (trousers, skirt) or "full" (dress, saree, lehenga, gown, jumpsuit); for the model, "framing": "full" if head to feet is visible, otherwise "partial".
   Users send all kinds of photos. Judge each one from what you actually see, not from the order or the file name.
   Set "output_view" to the view of the final image: the model photo's pose unless the user asks for another view.
   Set "styling" only from what the user asked for, otherwise leave a value null:
   - "tuck": "in" only when the user asks to tuck the top into the trousers; "out" when they say on top of the pants, not inside, untucked or outside. Tops are untucked by default.
   - "sleeves": "rolled" or "down".
   - "fit": "loose" or "fitted".
   - "pose": "change" ONLY when the user explicitly asks to change, move or re-pose the person (for example "make her turn", "have him sit", "change the pose"). Describing the pose they want, such as "full-body pose", "standing" or "in a pose", is NOT a change request: use null, so the model photo's pose is kept. "reference" when they send a pose photo; otherwise null.
   - "model": "change" only when they ask to swap the person for another model photo they sent.
   - "add": short names of objects to add to the look (for example "a watch", "sunglasses"), up to 5.
   - "remove": short names of things to remove from the image, up to 5.
   Keep the person's face, expression, skin tone, background and visible accessories unless the user asks to change them.
   For a logo: a garment photo that shows a logo or print gets "logo": true in photo_notes. A logo photo the user sends gets role "logo".
   Design references: when the user sends a garment photo only for its design (for example "a blouse inspired by this design", "same neckline and border as this", "take the back of this blouse"), set "design_only": true in that photo's note. Only the design is used: its neckline, borders, back cut and sleeve shape. Its colour and fabric are not used unless the user asks for them. Write the prompt so that the colour and fabric come from the user's words or from the main garment, and a saree the user sends stays exactly as in its photo. This applies to Indian garments such as blouses, cholis and kurtas.
   For each garment, also fill what you can see, in a few words each: "pattern" (print or pattern, its scale and arrangement), "colors", "fabric", "details" (embroidery, borders, buttons, zips, stitching), "logo_text" (exact text or logo name, only if readable), and "unclear" (what you cannot see). Describe only what is visible. Never guess.
   Your name is Daevora. You are an AI stylist that creates virtual try-on looks from the user's photos. Do not open replies with a greeting such as "hi" or "hello", and do not repeat your introduction; introduce yourself only when asked your name or what you do.
   Conversation: speak like a warm, professional stylist, in short plain sentences. When a request has several changes, say back in one sentence what you will create. Ask one question at a time, and only when a choice really changes the result.
   Safety: refuse, kindly and briefly, anything that is not fashion try-on: nudity, sexual content, anyone under 18, hateful content, or a real person's face put on someone who did not send that photo. Use only the people in the user's photos. Never invent brand names or logos.
   If the pose faces away (back or side) and you only have the front of the garment, still generate: say in "reply" that you will match the back to the fabric and that a photo of the garment's back gives exact details.

Reply with JSON only:
{"reply": string, "action": "reply" | "generate" | "upscale" | "remove_background", "prompt": string, "use_photos": number[], "use_previous": boolean, "resolution": string, "target_photo": number | null, "photo_notes": [{"photo": number, "role": string, "view": string, "worn"?: boolean, "logo"?: boolean, "design_only"?: boolean, "pattern"?: string, "colors"?: string, "fabric"?: string, "details"?: string, "logo_text"?: string, "unclear"?: string, "length"?: string, "framing"?: string}], "output_view": "front" | "back" | "side" | "three-quarter", "styling": {"tuck": string | null, "sleeves": string | null, "fit": string | null, "pose": string | null, "model": string | null, "add": string[], "remove": string[]}}
For "reply", "upscale" and "remove_background", use an empty prompt, an empty use_photos array, use_previous false and an empty photo_notes array. Use at most 5 photos.`;

const FALLBACK_TURN = {
  reply: 'Sorry, I could not work that out. Could you describe the look again?',
  action: 'reply',
  prompt: '',
  use_photos: [],
  use_previous: false,
  resolution: null,
  target_photo: null,
  photo_notes: [],
  output_view: 'front',
  styling: { tuck: null, sleeves: null, fit: null, pose: null, model: null, add: [], remove: [] },
};

/** One call to the chat model. Returns the reply text; HTTP errors throw. */
async function requestTurn({ messages, openaiKey, signal }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: 'gpt-4o', response_format: TURN_RESPONSE_FORMAT, messages }),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError({ status: res.status, code: upstreamCode(res.status), message: 'The assistant is unavailable. Try again.' });
  }
  return data?.choices?.[0]?.message?.content ?? '';
}

export function normalizeAction(parsed, { photoCount, newCount, firstNew, prompt }) {
  const known = ['reply', 'generate', 'upscale', 'remove_background'];
  let action = known.includes(parsed.action) ? parsed.action : parsed.generate ? 'generate' : 'reply';
  if (action === 'generate' && !prompt) action = 'reply';
  const t = Number(parsed.target_photo);
  const targetPhoto = Number.isInteger(t) && t >= 1 && t <= photoCount ? t : newCount > 0 ? firstNew : null;
  const resolution = ['2k', '3k', '4k'].includes(parsed.resolution) ? parsed.resolution : '4k';
  return { action, generate: action === 'generate', target_photo: targetPhoto, resolution };
}

/**
 * Which references the engine gets, in order. New photos from this message are always included;
 * the previous result is included when the assistant chose it (e.g. "add these shoes to the last image").
 */
export function decideReferences(parsed, { photoCount, newCount, firstNew, hasPrevious, forcePrevious = false, facts = [] }) {
  const listed = (Array.isArray(parsed.use_photos) ? parsed.use_photos : [])
    .map(Number)
    .filter((x) => Number.isInteger(x) && x >= 1 && x <= photoCount);
  const newPhotos = Array.from({ length: newCount }, (_, i) => firstNew + i);
  const usePrevious = (!!parsed.use_previous || forcePrevious) && !!hasPrevious;
  const { usePhotos } = selectImages({ previous: usePrevious, usePhotos: listed, newPhotos, facts });
  return { usePhotos, usePrevious };
}

/**
 * Run a chat turn on the server.
 * photos: [{id, src}] — session photos in order
 * Returns the standard turn shape plus enginePrompt (prompt + house rules + view rules).
 */
export async function chatTurn({ history, userText, photos, newCount = 0, lastPrompt, hasPrevious, forcePrevious = false, photoMeta = {}, openaiKey, signal, userId }) {
  const recent = photos.slice(-8);
  const offset = photos.length - recent.length;
  const firstNew = photos.length - newCount + 1;

  const intro =
    `Photos in this session: ${photos.length ? photos.map((_, i) => `photo ${i + 1}`).join(', ') : 'none yet'}.` +
    (newCount ? ` NEW in this message: ${newCount === 1 ? `photo ${firstNew}` : `photos ${firstNew}–${photos.length}`}.` : ' No new photos in this message.') +
    (hasPrevious ? ' A previous result exists.' : ' No previous result yet.') +
    (lastPrompt ? `\nPrevious prompt: ${lastPrompt}` : '');

  // Sanitize photo meta from the client before embedding in the prompt.
  // Each field is whitelisted to safe enum values or short free-text strings — no raw client data reaches the prompt.
  const ROLES = new Set(['model', 'garment', 'shoes', 'accessory', 'background', 'other']);
  const VIEWS = new Set(['front', 'back', 'side', 'three-quarter', 'flat-lay', 'unknown']);
  const LENGTHS = new Set(['upper', 'lower', 'full']);
  const FRAMINGS = new Set(['full', 'partial']);
  const PERSONS = new Set(['human', 'mannequin']);
  const GENDERS = new Set(['woman', 'man', 'unknown']);
  const POSES = new Set(['standing', 'sitting', 'walking', 'turned away', 'other']);
  const SHOTS = new Set(['full_body', 'cropped_head', 'three_quarter', 'half_body', 'close_up']);
  const SLEEVES = new Set(['sleeveless', 'short', 'long', 'none']);
  const clip = (s, max = 60) => (typeof s === 'string' ? s.replace(/[\r\n]/g, ' ').slice(0, max) : null);

  const metaLines = photos
    .map((p, i) => {
      const m = photoMeta[p.id];
      if (!m || typeof m !== 'object') return null;
      const role = ROLES.has(m.role) ? m.role : null;
      const type = clip(m.type, 40);
      const color = clip(m.color, 40);
      const fabric = clip(m.fabric, 30);
      const view = VIEWS.has(m.view) ? `view: ${m.view}` : null;
      const worn = role === 'garment' && typeof m.worn === 'boolean' ? `worn: ${m.worn}` : null;
      const length = LENGTHS.has(m.length) ? `length: ${m.length}` : null;
      const framing = FRAMINGS.has(m.framing) ? `framing: ${m.framing}` : null;
      const pattern = role === 'garment' ? clip(m.pattern, 80) && `pattern: ${clip(m.pattern, 80)}` : null;
      const details = role === 'garment' ? clip(m.details, 100) && `details: ${clip(m.details, 100)}` : null;
      const notes = clip(m.notes, 80);
      const person = role === 'model' && PERSONS.has(m.person) ? `person: ${m.person}` : null;
      const gender = role === 'model' && GENDERS.has(m.gender) ? `gender: ${m.gender}` : null;
      const pose = role === 'model' && POSES.has(m.pose) ? `pose: ${m.pose}` : null;
      const shot = role === 'model' && SHOTS.has(m.shot) ? `shot: ${m.shot}` : null;
      const sleeve = role === 'garment' && SLEEVES.has(m.sleeve) ? `sleeve: ${m.sleeve}` : null;
      const neckline = role === 'garment' && clip(m.neckline, 40) ? `neckline: ${clip(m.neckline, 40)}` : null;
      const style = role === 'garment' && clip(m.style, 80) ? `style: ${clip(m.style, 80)}` : null;
      const parts = [role, person, gender, pose, shot, type, color, fabric, pattern, details, style, neckline, sleeve, view, worn, length, framing, notes].filter(Boolean);
      if (!parts.length) return null;
      return `photo ${i + 1}: ${parts.join(', ')}`;
    })
    .filter(Boolean);

  const introWithMeta = metaLines.length ? `${intro}\nPre-analyzed photos:\n${metaLines.join('\n')}` : intro;

  const content = [{ type: 'text', text: introWithMeta }];
  recent.forEach((p, i) => {
    const n = offset + i + 1;
    content.push({ type: 'text', text: `photo ${n}${n >= firstNew ? ' (NEW)' : ''}:` });
    content.push({ type: 'image_url', image_url: { url: p.src, detail: 'high' } });
  });
  content.push({ type: 'text', text: `User says: ${String(userText || '').slice(0, 1000) || '(sent photos only)'}` });

  const messages = [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content }];
  let parsed = null;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    const text = await requestTurn({ messages, openaiKey, signal });
    const checked = parseTurnReply(text);
    if (checked.ok) parsed = checked.value;
    else console.warn('[assistant] reply rejected', { attempt, reason: checked.reason, sample: String(text ?? '').slice(0, 200) });
  }
  if (!parsed) parsed = FALLBACK_TURN;

  const n = photos.length;
  const tagsByPhoto = Object.fromEntries(photos.map((p, i) => [i + 1, photoMeta[p.id] ?? {}]));
  const roleOverrides = Object.fromEntries(photos.map((p, i) => [i + 1, photoMeta[p.id]?.role_user]).filter(([, r]) => r));
  const facts = applyRoleOverrides(mergePhotoFacts({ tagsByPhoto, notes: normalizeNotes(parsed.photo_notes, n), photoCount: n }), roleOverrides);
  const { usePhotos, usePrevious } = decideReferences(parsed, { photoCount: n, newCount, firstNew, hasPrevious, forcePrevious, facts });
  const prompt = String(parsed.prompt ?? '').slice(0, 10000);

  const turn = {
    reply: String(parsed.reply ?? '').slice(0, 600) || 'Tell me a bit more about the look you want.',
    ...normalizeAction(parsed, { photoCount: n, newCount, firstNew, prompt }),
    prompt,
    use_photos: usePhotos,
    use_previous: usePrevious,
    photo_notes: normalizeNotes(parsed.photo_notes, n),
    output_view: normalizeView(parsed.output_view),
    image_roles: usePhotos.map((p) => facts.find((f) => f.photo === p)?.role ?? 'other'),
    styling: normalizeStyling(parsed.styling),
  };

  // Build the full engine prompt (assistant prompt + house rules + view rules) on the server.
  const check = turn.generate
    ? preflight({ usePrevious: turn.use_previous, usePhotos: turn.use_photos, outputView: turn.output_view, styling: turn.styling }, facts)
    : { ok: true };
  if (!check.ok) {
    Object.assign(turn, { action: 'reply', generate: false, reply: check.question, prompt: '', use_photos: [], use_previous: false, photo_notes: [] });
  } else if (check.notice && !turn.reply.includes(check.notice)) {
    turn.reply = `${turn.reply} ${check.notice}`.trim();
  }
  const enginePrompt = turn.generate
    ? buildPrompt({
        prompt: turn.prompt,
        notes: facts,
        usePhotos: turn.use_photos.filter((idx) => idx >= 1 && idx <= n),
        usePrevious: turn.use_previous,
        outputView: turn.output_view,
        styling: turn.styling,
      })
    : '';

  logTurn({
    user: userId ?? null,
    action: turn.action,
    photos: photos.map((p) => p.src),
    roles: facts,
    plan: { usePhotos: turn.use_photos, usePrevious: turn.use_previous, outputView: turn.output_view, styling: turn.styling },
    enginePrompt,
  });
  return { ...turn, enginePrompt };
}

/**
 * Rewrite the user's short request into a clear, specific instruction.
 */
export async function enhanceRequest({ text, photoCount, openaiKey, signal }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
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
    throw new ApiError({ status: res.status, code: upstreamCode(res.status), message: 'The assistant is unavailable. Try again.' });
  }
  let parsed = {};
  try {
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
  } catch {}
  return String(parsed.text ?? '').trim().slice(0, 600) || text;
}
