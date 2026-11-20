// Everything about accepting a user photo: validation, conversion and wording of problems.
// UI components call these and never re-implement the checks.
import { fileToJpegDataURI, isHttpUrl } from '@/api/fashn.js';

export const ACCEPT = 'image/jpeg,image/png,image/webp';
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // refuse huge files before decoding them
export const HARD_MIN_SIDE = 64; // below this the photo is useless
export const SOFT_MIN_SIDE = 512; // below this we accept it but warn
export const MAX_ASPECT = 3; // longer / shorter side; beyond this we warn

const HEIC_RE = /\.(heic|heif)$/i;
const BLOCKED_TYPES = new Set(['image/svg+xml', 'image/heic', 'image/heif']);

/** Returns a user-facing problem for a file, or null if it can be read. */
export function checkFile(file) {
  const name = file?.name || 'This file';
  if (!file) return 'No file was received';
  if (HEIC_RE.test(file.name || '') || file.type === 'image/heic' || file.type === 'image/heif') {
    return `"${name}" is a HEIC photo, which browsers cannot read. Export it as JPEG or PNG and try again.`;
  }
  if (BLOCKED_TYPES.has(file.type)) return `"${name}" is a vector image. Use a JPEG, PNG or WebP photo.`;
  if (!file.type.startsWith('image/')) return `"${name}" is not an image. Use a JPEG, PNG or WebP photo.`;
  if (file.size === 0) return `"${name}" is empty.`;
  if (file.size > MAX_FILE_BYTES) {
    return `"${name}" is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${MAX_FILE_BYTES / 1048576} MB.`;
  }
  return null;
}

/** Returns a user-facing problem for a pasted/typed link, or null. */
export function checkUrl(raw) {
  const u = String(raw ?? '').trim();
  if (!u) return 'Paste an image link first';
  if (/^data:/i.test(u)) return 'Upload the file instead of pasting a data link';
  if (!isHttpUrl(u)) return 'Enter a public http(s) image link';
  return null;
}

/** Picks the first usable image from a FileList/array. `extra` counts the ones that were ignored. */
export function pickImageFile(files) {
  const list = [...(files ?? [])];
  const images = list.filter((f) => f.type?.startsWith('image/') || HEIC_RE.test(f.name || ''));
  return { file: images[0] ?? null, extra: Math.max(0, images.length - 1), nonImages: list.length - images.length };
}

/**
 * Validates, downsizes and converts a file to a value for ImageSlot.
 * Throws an Error with a user-facing message when the photo cannot be used.
 * `warning` is set for photos that are usable but likely to give poor results.
 */
export async function prepareFile(file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);

  let r;
  try {
    r = await fileToJpegDataURI(file);
  } catch {
    throw new Error(`"${file.name}" could not be opened. It may be damaged. Try saving it again as JPEG or PNG.`);
  }

  const shortSide = Math.min(r.originalWidth, r.originalHeight);
  const longSide = Math.max(r.originalWidth, r.originalHeight);
  if (shortSide < HARD_MIN_SIDE) throw new Error(`"${file.name}" is too small (${r.originalWidth}×${r.originalHeight}). Use a larger photo.`);

  let warning = null;
  if (shortSide < SOFT_MIN_SIDE) warning = 'Low resolution: the result may look soft';
  else if (longSide / shortSide > MAX_ASPECT) warning = 'Very narrow photo: it may be cropped';

  const resized = r.width !== r.originalWidth;
  return {
    src: r.dataURI,
    kind: 'file',
    name: file.name,
    info: `${r.width}×${r.height}${resized ? ` (from ${r.originalWidth}×${r.originalHeight})` : ''}`,
    warning,
  };
}

/** Value for a photo given by link. The browser loads it later; ImageSlot reports a failed load. */
export function urlValue(raw) {
  const u = String(raw).trim();
  let name = u;
  try {
    name = decodeURIComponent(new URL(u).pathname.split('/').pop() || u);
  } catch {
    /* keep the raw link as the name */
  }
  return { src: u, kind: 'url', name, info: 'From link', warning: null };
}
