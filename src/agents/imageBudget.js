// Chooses the reference images for one engine call, within the engine's limit of 6 images.
// Order: the previous result (always first when used), then session photos by role priority.
// The returned usePhotos order is the engine's image order, so "image N" in the prompt matches.

export const MAX_ENGINE_IMAGES = 6;

// Lower rank = kept first when the limit is reached.
const ROLE_RANK = { model: 1, garment: 2, logo: 2, pose: 3, shoes: 4, background: 5, accessory: 6, other: 7 };
const rankOf = (role) => ROLE_RANK[role] ?? ROLE_RANK.other;

const unique = (list) => [...new Set(list.filter((x) => Number.isInteger(x)))];

/**
 * previous: whether the previous result is used (it takes image 1)
 * usePhotos: session photo numbers the assistant listed
 * newPhotos: session photo numbers sent in this message
 * facts: merged photo facts ({ photo, role, ... }) from photoFacts.js
 *
 * A NEW photo is added only when the assistant listed it, or when the assistant listed no photos at all
 * and the photo has a known role. Returns { usePrevious, usePhotos } with usePhotos in engine order.
 */
export function selectImages({ previous = false, usePhotos = [], newPhotos = [], facts = [] }) {
  const roleOf = (photo) => facts.find((f) => f.photo === photo)?.role ?? 'other';
  const listed = unique(usePhotos);
  const extra = listed.length === 0 ? unique(newPhotos).filter((p) => roleOf(p) !== 'other') : [];
  const candidates = unique([...listed, ...extra]).map((photo, i) => ({ photo, i, rank: rankOf(roleOf(photo)) }));

  candidates.sort((a, b) => a.rank - b.rank || a.i - b.i);
  const room = MAX_ENGINE_IMAGES - (previous ? 1 : 0);
  const kept = candidates.slice(0, Math.max(0, room));
  return { usePrevious: !!previous, usePhotos: kept.map((k) => k.photo) };
}
