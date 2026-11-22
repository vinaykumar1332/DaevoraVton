// One set of facts per photo for the engine prompt.
// The chat's photo_notes (read at high detail for this request) win for every field they set.
// The upload-time tags only fill fields the notes leave empty. Values are cleaned by normalizeNotes.
import { normalizeNotes } from './studioPrompt.js';

const isSet = (v) => v !== null && v !== undefined && v !== '';

/** Upload-time tag names -> the note field names the prompt builder reads. */
const TAG_TO_NOTE = {
  role: 'role',
  view: 'view',
  worn: 'worn',
  logo: 'logo',
  pattern: 'pattern',
  color: 'colors',
  fabric: 'fabric',
  details: 'details',
  logo_text: 'logo_text',
  unclear: 'unclear',
  length: 'length',
  framing: 'framing',
};
const NOTE_FIELDS = ['role', 'view', 'worn', 'logo', 'design_only', 'pattern', 'colors', 'fabric', 'details', 'logo_text', 'unclear', 'length', 'framing'];

/**
 * tagsByPhoto: { [photoNumber]: upload-time tags }
 * notes: the chat's photo_notes (session photo numbers)
 * Returns the merged notes for every photo that has either source, cleaned to the allowed values.
 */
export function mergePhotoFacts({ tagsByPhoto = {}, notes = [], photoCount }) {
  const fromNotes = new Map();
  for (const n of Array.isArray(notes) ? notes : []) {
    if (n && Number.isInteger(n.photo) && !fromNotes.has(n.photo)) fromNotes.set(n.photo, n);
  }
  const numbers = [...new Set([...fromNotes.keys(), ...Object.keys(tagsByPhoto).map(Number)])].sort((a, b) => a - b);

  const merged = numbers.map((photo) => {
    const note = fromNotes.get(photo) ?? {};
    const tags = tagsByPhoto[photo] ?? {};
    const out = { photo };
    for (const field of NOTE_FIELDS) {
      const tagField = Object.keys(TAG_TO_NOTE).find((k) => TAG_TO_NOTE[k] === field);
      const fromTag = tagField ? tags[tagField] : undefined;
      out[field] = isSet(note[field]) ? note[field] : isSet(fromTag) ? fromTag : undefined;
    }
    return out;
  });
  return normalizeNotes(merged, photoCount);
}

const USER_ROLES = ['model', 'garment', 'shoes', 'accessory', 'background', 'logo', 'pose', 'other'];

/**
 * A role the user set on a photo always wins over the chat's notes and the upload tags.
 * roleOverrides: { [photoNumber]: role } from the client's role_user field.
 */
export function applyRoleOverrides(facts = [], roleOverrides = {}) {
  const chosen = Object.fromEntries(Object.entries(roleOverrides).filter(([, r]) => USER_ROLES.includes(r)).map(([k, r]) => [Number(k), r]));
  const known = new Set(facts.map((f) => f.photo));
  const merged = facts.map((f) => (chosen[f.photo] ? { ...f, role: chosen[f.photo] } : f));
  for (const [photo, role] of Object.entries(chosen)) {
    if (!known.has(Number(photo))) merged.push({ photo: Number(photo), role });
  }
  return merged.sort((a, b) => a.photo - b.photo);
}
