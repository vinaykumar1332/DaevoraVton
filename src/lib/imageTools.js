// Client-side result tools: mirror, flip, rotate, crop, colour, output size and format.
// All done in a canvas, so nothing is re-generated and no credits are used.
import { proxiedUrl } from '@/api/fashn.js';

export const RATIOS = [
  { id: 'orig', label: 'Original', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
];

export const WIDTHS = [null, 1080, 1440, 2048]; // null = keep original pixel size
export const FORMATS = [
  { id: 'png', mime: 'image/png', ext: 'png' },
  { id: 'jpeg', mime: 'image/jpeg', ext: 'jpg' },
];

export const DEFAULT_SETTINGS = {
  mirror: false, // flip left/right
  flipV: false, // flip top/bottom
  rotate: 0, // 0, 90, 180, 270
  ratio: null, // null = no crop, otherwise width / height
  zoom: 1, // 1 = largest crop for the ratio, up to 3x
  cx: 0.5, // crop centre, 0..1 of the (rotated) width
  cy: 0.5, // crop centre, 0..1 of the (rotated) height
  width: null, // output width in px, null = crop size
  format: 'png',
  brightness: 100, // %
  contrast: 100, // %
  saturate: 100, // %
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Source rectangle for the crop, in pixels of an image of size W×H. */
export function cropRect(W, H, s) {
  if (s.ratio == null) return { sx: 0, sy: 0, sw: W, sh: H };
  const r = s.ratio;
  let bw;
  let bh;
  if (W / H > r) {
    bh = H;
    bw = H * r;
  } else {
    bw = W;
    bh = W / r;
  }
  const z = Math.max(1, s.zoom || 1);
  const sw = bw / z;
  const sh = bh / z;
  return {
    sx: clamp(s.cx * W - sw / 2, 0, W - sw),
    sy: clamp(s.cy * H - sh / 2, 0, H - sh),
    sw,
    sh,
  };
}

async function loadBitmap(url) {
  const res = await fetch(proxiedUrl(url));
  if (!res.ok) throw new Error(`Image request failed (${res.status})`);
  return createImageBitmap(await res.blob());
}

const canvasOf = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Renders the image with the given settings and returns a Blob (PNG or JPEG). */
export async function renderImage(url, s = DEFAULT_SETTINGS) {
  const bmp = await loadBitmap(url);
  const rotate = s.rotate || 0;
  const swap = rotate === 90 || rotate === 270;
  const W = swap ? bmp.height : bmp.width;
  const H = swap ? bmp.width : bmp.height;

  // 1. Rotate.
  const c1 = canvasOf(W, H);
  const x1 = c1.getContext('2d');
  x1.translate(W / 2, H / 2);
  x1.rotate((rotate * Math.PI) / 180);
  x1.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);

  // 2. Crop, then 3. scale to the output width, flip and colour.
  const { sx, sy, sw, sh } = cropRect(W, H, s);
  const outW = Math.round(s.width || sw);
  const outH = Math.round((outW * sh) / sw);
  const c2 = canvasOf(outW, outH);
  const x2 = c2.getContext('2d');
  x2.imageSmoothingQuality = 'high';
  const fx = s.mirror ? -1 : 1;
  const fy = s.flipV ? -1 : 1;
  x2.translate(fx < 0 ? outW : 0, fy < 0 ? outH : 0);
  x2.scale(fx, fy);
  x2.filter = `brightness(${s.brightness ?? 100}%) contrast(${s.contrast ?? 100}%) saturate(${s.saturate ?? 100}%)`;
  x2.drawImage(c1, sx, sy, sw, sh, 0, 0, outW, outH);

  const fmt = FORMATS.find((f) => f.id === s.format) ?? FORMATS[0];
  return new Promise((resolve, reject) =>
    c2.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), fmt.mime, 0.95)
  );
}
