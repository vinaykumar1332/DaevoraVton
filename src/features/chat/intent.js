// Fast, local detection of "tool only" requests in the chat, so they go straight to the matching
// module (Upscale, Remove background) instead of a full re-generation, with no AI call needed.
// Only fires when EVERY meaningful word belongs to the tool's vocabulary: "upscale to 4k" is a
// tool request, "make it red and upscale" is not (the assistant decides those).

const FILLER = new Set(
  (
    'please pls plz can could would will you u me my i we want need like to the a an this that these it its ' +
    'image images photo photos picture pic pics look result last previous latest one of in into on and then for now ' +
    'just only make get give do version size kindly also go ahead with hey hi ok okay thanks thank so bit little'
  ).split(' ')
);
const DOWNLOAD = new Set(['download', 'save', 'export']);

const UPSCALE = new Set([
  'upscale', 'upscaled', 'upscaling', 'upscal', 'scale', 'up', 'enhance', 'enhanced', 'sharpen', 'sharper', 'crisper',
  'clearer', 'hd', 'uhd', 'higher', 'high', 'increase', 'bigger', 'larger', 'resolution', 'res', 'quality', 'super',
  'improve', 'better', '2k', '3k', '4k', 'max', 'maximum', 'full',
]);
const UPSCALE_STRONG = ['upscale', 'upscaled', 'upscaling', 'upscal', 'sharpen', 'sharper', 'crisper', 'hd', 'uhd', '2k', '3k', '4k', 'resolution'];

const CUTOUT = new Set(['remove', 'removed', 'erase', 'delete', 'drop', 'background', 'bg', 'backdrop', 'cutout', 'cut', 'out', 'transparent', 'png', 'isolate', 'no', 'without']);
const CUTOUT_BG = ['background', 'bg', 'backdrop'];
const CUTOUT_VERB = ['remove', 'removed', 'erase', 'delete', 'drop', 'no', 'without', 'transparent', 'isolate'];

// Words that point back to something earlier in the chat (the previous result or earlier photos).
const BACK_REFERENCE =
  /\b(previous|earlier|before|last|again|same|keep|original|result|her|him|she|he|them|they|it on|that (saree|dress|look|outfit|model|person|man|woman|girl|boy|background|photo|image|one)|this look|the look|(photo|image|pic) ?\d|(first|second|third|other) (one|photo|image|model|look))\b/i;

/**
 * True when a message refers back to earlier photos or the previous result.
 * A message with NEW photos that does not refer back starts a fresh look from those photos only,
 * so an earlier garment (e.g. a saree) cannot leak into a new look (e.g. a man in a shirt).
 */
export const refersBack = (text) => BACK_REFERENCE.test(String(text ?? ''));

/**
 * @returns {null | { tool: 'upscale', resolution: '2k'|'3k'|'4k', download: boolean }
 *                 | { tool: 'remove_background', download: boolean }}
 */
export function detectToolIntent(text) {
  const tokens = String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const download = tokens.some((t) => DOWNLOAD.has(t));
  const words = tokens.filter((t) => !FILLER.has(t) && !DOWNLOAD.has(t));
  if (!words.length) return null;
  const has = (list) => list.some((w) => words.includes(w));

  if (words.every((w) => UPSCALE.has(w)) && (has(UPSCALE_STRONG) || (words.includes('scale') && words.includes('up')))) {
    const res = words.find((w) => /^[234]k$/.test(w));
    return { tool: 'upscale', resolution: res ?? '4k', download };
  }
  if (words.every((w) => CUTOUT.has(w)) && ((has(CUTOUT_BG) && has(CUTOUT_VERB)) || words.includes('cutout') || (words.includes('cut') && words.includes('out')))) {
    return { tool: 'remove_background', download };
  }
  return null;
}
