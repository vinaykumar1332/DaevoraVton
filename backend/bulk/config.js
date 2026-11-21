// Bulk VTON limits and switches. Everything here is read by the bulk module only.
const int = (v, fallback, min, max) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const MAX_BULK_IMAGES = int(process.env.MAX_BULK_IMAGES, 20, 1, 200);
export const BULK_CONCURRENCY = int(process.env.BULK_CONCURRENCY, 1, 1, 4);

// Live calls spend OpenAI and FASHN credits. They stay off until BULK_LIVE=1 is set on purpose.
export const BULK_LIVE = process.env.BULK_LIVE === '1';

export const LIMITS = {
  zipBytes: 60 * 1024 * 1024, // compressed upload
  entries: 400, // files inside the archive, including ones we skip
  uncompressedBytes: 250 * 1024 * 1024, // total after decompression (zip-bomb guard)
  imageBytes: 25 * 1024 * 1024,
  minSide: 256,
  maxSide: 8000,
  mappingBytes: 2 * 1024 * 1024,
  promptChars: 500,
};

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
export const GARMENT_FIELDS = ['top_image', 'bottom_image', 'dress_image', 'saree_image', 'shoes_image'];
export const MAPPING_FIELDS = ['job_id', 'model_image', ...GARMENT_FIELDS, 'background_image', 'prompt_instruction', 'output_name', 'enabled'];
