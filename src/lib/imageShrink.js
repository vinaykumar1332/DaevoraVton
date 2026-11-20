// Smaller copies of photos for the chat and analysis requests. Vercel caps a request body at 4.5 MB,
// so eight full-size photos in one chat turn would be rejected before the server runs.
// The image engine still gets the full-size photos.
const STEPS = [
  [1600, 0.85],
  [1280, 0.8],
  [1024, 0.75],
];

function collectImages(node, out) {
  if (typeof node === 'string') {
    if (node.startsWith('data:image/')) out.add(node);
  } else if (Array.isArray(node)) node.forEach((n) => collectImages(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => collectImages(n, out));
  return out;
}

function replaceImages(node, map) {
  if (typeof node === 'string') return map.get(node) ?? node;
  if (Array.isArray(node)) return node.map((n) => replaceImages(n, map));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replaceImages(v, map)]));
  return node;
}

/**
 * Returns the request body unchanged when it fits the budget. Otherwise re-encodes its photos,
 * a step at a time, until it fits. Vercel rejects bodies over 4.5 MB before our code runs.
 */
export async function fitPayload(body, budget = 3.5 * 1024 * 1024) {
  if (JSON.stringify(body).length <= budget) return body;
  const map = new Map([...collectImages(body, new Set())].map((s) => [s, s]));
  for (const [side, quality] of STEPS) {
    for (const k of map.keys()) map.set(k, await shrinkDataURI(map.get(k), side, quality).catch(() => map.get(k)));
    const candidate = replaceImages(body, map);
    if (JSON.stringify(candidate).length <= budget) return candidate;
  }
  return replaceImages(body, map);
}

export async function shrinkDataURI(src, maxSide = 1024, quality = 0.82) {
  if (!src.startsWith('data:image/')) return src;
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('image could not be read'));
    el.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return src;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
