// Workflow registry + run logic for every engine (FASHN /v1/run, FASHN Agent, OpenAI).
// Each workflow declares its form fields, how to run, and an estimated credit cost.
import {
  OUTFIT_MODES, ETHNIC_TYPES, SAREE_DRAPES, DUPATTA_STYLES, ETHNIC_SETTINGS, WITH_DUPATTA,
  MAX_AGENT_PHOTOS, modeOf, inMode, outfitProblems,
} from '@/workflows/outfitModes.js';
import {
  api,
  sleep,
  toFashnError,
  FashnError,
  runAgent,
  pollAgent,
  extractAgentResults,
  tryonCost,
  agentCostPerImage,
} from '@/api/fashn.js';
import { editWithOpenAI } from '@/api/openai.js';
import { writePrompt } from '@/agents/promptAgent.js';
import { friendlyStatus } from '@/lib/messages.js';

/* ------------------------------------------------------------------ */
/* Low-level FASHN helpers                                             */
/* ------------------------------------------------------------------ */

const srcOf = (v) => v?.src;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const addCredits = (a, b) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

async function startRun(model_name, inputs, signal) {
  const data = await api('/v1/run', { method: 'POST', body: { model_name, inputs: clean(inputs) }, signal });
  if (data?.error) throw toFashnError(data);
  if (!data?.id) throw toFashnError(data ?? 'No job id returned');
  return data.id;
}

async function pollRun(id, { signal, onUpdate }) {
  for (;;) {
    const d = await api(`/v1/status/${encodeURIComponent(id)}`, { signal });
    onUpdate?.(d);
    if (d.status === 'completed') {
      const images = Array.isArray(d.output) ? d.output : (d.output?.images ?? []);
      return { images, credits: d.credits_used ?? null };
    }
    if (d.status === 'failed' || d.status === 'canceled') throw toFashnError(d.error ?? { error: d.status });
    await sleep(2000, signal);
  }
}

/** Generic /v1/run job: model_name + inputs. */
async function fashnRun(model_name, inputs, { signal, onStatus }) {
  const id = await startRun(model_name, inputs, signal);
  onStatus?.('Preparing your image…');
  const r = await pollRun(id, { signal, onUpdate: (d) => onStatus?.(friendlyStatus(d.status)) });
  return { images: r.images, credits: r.credits, jobIds: [id] };
}

/** FASHN Agent job (prompt + up to 6 images). */
export async function agentJob({ prompt, images, resolution, generation_mode, aspect_ratio }, { signal, onStatus }) {
  const id = await runAgent({ prompt, images, resolution, generation_mode, aspect_ratio }, signal);
  onStatus?.('Preparing your image…');
  const final = await pollAgent(id, {
    signal,
    onUpdate: (d) => {
      const tools = (d.predictions ?? []).map((p) => p.tool).filter(Boolean);
      onStatus?.(friendlyStatus(d.status));
    },
  });
  const ex = extractAgentResults(final);
  return { images: ex.images, credits: ex.creditsUsed, tools: ex.tools, jobIds: [id] };
}

const need = (img, what) => {
  if (!img) throw new FashnError({ status: 422, code: 'NoImageGenerated', message: `${what} produced no image` });
  return img;
};

/* ------------------------------------------------------------------ */
/* Option lists (from docs.fashn.ai)                                   */
/* ------------------------------------------------------------------ */

const RES = ['1k', '2k', '4k'];
const RES_AGENT = ['1k', '2k', '3k', '4k'];
const GEN = ['fast', 'balanced', 'quality'];
const AR_AGENT = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const AR_PRODUCT = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '4:5', '5:4'];
const AR_CREATE = ['21:9', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '1:1'];
const AR_REFRAME = ['21:9', '1:1', '4:3', '3:2', '2:3', '5:4', '4:5', '3:4', '16:9', '9:16'];
const SEED_MAX = 4294967295;

/* ------------------------------------------------------------------ */
/* Field builders                                                      */
/* ------------------------------------------------------------------ */

const img = (key, label, o = {}) => ({ key, label, type: 'image', ...o });
const imgs = (key, label, max, o = {}) => ({ key, label, type: 'images', max, ...o });
const text = (key, label, o = {}) => ({ key, label, type: 'text', ...o });
const num = (key, label, min, max, def, o = {}) => ({ key, label, type: 'number', min, max, default: def, ...o });
const sel = (key, label, list, def, { auto, ...o } = {}) => ({
  key,
  label,
  type: 'select',
  options: [...(auto ? [{ label: auto, value: '' }] : []), ...list.map((v) => (typeof v === 'string' ? { label: v, value: v } : v))],
  default: def,
  ...o,
});
const seedField = num('seed', 'Seed', 0, SEED_MAX, 42, { hint: 'Same seed + same inputs = repeatable result' });
const countField = (key = 'num_images', label = 'Images per run') => num(key, label, 1, 4, 1);

/* ------------------------------------------------------------------ */
/* Agent prompt presets                                                */
/* ------------------------------------------------------------------ */

export const PRESETS = [
  {
    group: 'Try-on',
    label: 'Garment swap (exact details)',
    needs: '1 = model, 2 = garment',
    prompt:
      'Put the garment from image 2 on the model in image 1. Keep face, pose, body shape and background unchanged. Preserve exact embroidery, print and colour of the garment. Full-body, studio lighting.',
  },
  {
    group: 'Try-on',
    label: 'Top + bottom',
    needs: '1 = model, 2 = top, 3 = bottom',
    prompt: 'Dress the model in image 1 with the top from image 2 and the bottom from image 3. Keep everything else identical.',
  },
  {
    group: 'Try-on',
    label: 'Outfit + grey studio (e-com 3:4)',
    needs: '1 = model, 2 = outfit',
    prompt:
      'Put the outfit from image 2 on the model in image 1, then place her on a plain light-grey studio background, 3:4 e-commerce framing.',
    settings: { aspect_ratio: '3:4' },
  },
  {
    group: 'Try-on',
    label: 'Saree – Nivi drape',
    needs: '1 = model, 2 = saree',
    prompt:
      'Put the saree from image 2 on the model in image 1, draped Nivi style with pallu over left shoulder. Keep the border and pallu design exactly as in the product image.',
  },
  {
    group: 'Docs examples',
    label: 'Product → on-model (no model photo)',
    needs: '1 = garment',
    prompt: 'Show the jacket in the first image on a model in a bright studio, full body, front view',
  },
  {
    group: 'Docs examples',
    label: 'Multi-angle (3 images)',
    needs: '1 = garment',
    prompt:
      'Show the dress in the first image on a model in a bright studio. Make three images from different angles: front, three-quarter, and side, full body.',
    settings: { aspect_ratio: '3:4' },
  },
  {
    group: 'Docs examples',
    label: 'Packshot on white',
    needs: '1 = product',
    prompt: 'Make a packshot of the bag in the first image, alone on a plain white background with a soft studio shadow',
    settings: { aspect_ratio: '1:1' },
  },
  {
    group: 'Docs examples',
    label: 'Catalog: one image per garment',
    needs: '1 = model, 2–4 = garments',
    prompt:
      'Put each garment from images 2 to 4 on the model from image 1, one image per garment. Full body, front view, plain light gray studio background, the same pose and lighting in every image.',
    settings: { resolution: '2k' },
  },
  {
    group: 'Docs examples',
    label: 'Lookbook (4 looks, location)',
    needs: '1 = model, 2 = location, 3–6 = outfits',
    prompt:
      'Make a lookbook of four full body photos. Image 1 is the model, image 2 is the location, and images 3 to 6 are four outfits, one per look. Place the model in the location from image 2 wearing each outfit, with a different natural editorial pose in each look. In every look, use the face from image 1, so the model matches image 1 exactly.',
    settings: { resolution: '2k', aspect_ratio: '2:3', generation_mode: 'quality' },
  },
];

export const PROMPT_TIPS = [
  'Refer to inputs by position ("image 1", "the first image") or by content ("the dress in image 2"). Images are numbered in upload order.',
  'The Agent never asks questions — it guesses. Spell out framing (full body / half body), background, pose, view and how many images you want.',
  'It only does what you ask: request upscales, background removal or variations explicitly. Each output image is billed.',
  'An aspect ratio or size written in the prompt overrides the dropdowns.',
  'Say what must NOT change: "keep face, pose, body shape and background unchanged".',
  'For exact product fidelity, name the details: "preserve the embroidery, print, border and colour exactly".',
  'Draft with "fast" mode at 1k, then switch to "quality" + 2k/4k for final assets.',
  'Images only — video requests fail with NoImageGenerated.',
];

/* ------------------------------------------------------------------ */
/* Guided try-on flow: garment → shoes → background                    */
/* ------------------------------------------------------------------ */

async function runGuided(v, ctx) {
  const base = { resolution: v.resolution, generation_mode: v.generation_mode, num_images: 1, output_format: 'png' };
  const steps = [];
  const jobIds = [];
  let credits = null;
  const take = (r) => {
    credits = addCredits(credits, r.credits);
    jobIds.push(...r.jobIds);
    return r.images[0];
  };

  let current = need(
    take(
      await fashnRun(
        'tryon-max',
        { ...base, model_image: srcOf(v.model), product_image: srcOf(v.garment) },
        { ...ctx, onStatus: (m) => ctx.onStatus?.(`Step 1 · ${m}`) }
      )
    ),
    'Garment try-on'
  );
  steps.push({ label: 'Garment try-on', images: [current] });

  if (v.shoes) {
    current = need(
      take(
        await fashnRun(
          'tryon-max',
          { ...base, model_image: current, product_image: srcOf(v.shoes) },
          { ...ctx, onStatus: (m) => ctx.onStatus?.(`Step 2 · ${m}`) }
        )
      ),
      'Shoe try-on'
    );
    steps.push({ label: 'Shoes / accessory', images: [current] });
  }

  const desc = v.bgPrompt?.trim();
  const bg = srcOf(v.background);
  if (bg || desc) {
    let prompt = bg
      ? 'Place the person from image 1 in the setting shown in image 2. Keep the person, pose, outfit and shoes exactly unchanged. Match lighting and perspective.'
      : `Place the person from image 1 in this setting: ${desc}. Keep the person, pose, outfit and shoes exactly unchanged. Match lighting and perspective.`;
    if (bg && desc) prompt += ` Setting notes: ${desc}.`;
    const r = await agentJob(
      { prompt, images: bg ? [current, bg] : [current], resolution: v.resolution, generation_mode: v.generation_mode },
      { ...ctx, onStatus: (m) => ctx.onStatus?.(`Step 3 · ${m}`) }
    );
    current = need(take(r), 'Background step');
    steps.push({ label: 'Background', images: [current] });
  }

  return { images: [current], steps, jobIds, credits };
}

/* ------------------------------------------------------------------ */
/* Workflow registry                                                   */
/* ------------------------------------------------------------------ */

export const WORKFLOWS = [
  /* ---------- Try-on ---------- */
  {
    id: 'guided',
    group: 'Try-on',
    label: 'Guided try-on flow',
    short: 'Garment → shoes → background',
    icon: 'Network',
    engine: 'Pipeline',
    blurb: 'One guided run: dress the model, add shoes or accessories, then change the background. Each step feeds the next.',
    steps: ['Upload the model photo', 'Upload the garment', 'Optional: shoes / bag, and a background photo or description', 'Generate — each step is shown in the result'],
    fields: [
      img('model', '1 · Model photo', { required: true, hint: 'The person to dress' }),
      img('garment', '2 · Garment', { required: true, hint: 'Top, bottom or dress' }),
      img('shoes', '3 · Shoes or accessory', { hint: 'Optional — adds a second try-on step' }),
      img('background', '4 · Background photo', { hint: 'Optional' }),
      text('bgPrompt', '…or describe the background', { placeholder: 'e.g. bright studio, soft daylight' }),
      sel('resolution', 'Resolution', RES, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
    ],
    credits: (v) =>
      tryonCost(v.generation_mode, v.resolution, 1) * (v.shoes ? 2 : 1) +
      (v.background || v.bgPrompt?.trim() ? agentCostPerImage(v.generation_mode, v.resolution) : 0),
    run: runGuided,
  },
  {
    // Upload-form version of AI Studio, in three workflows (see outfitModes.js): product to model,
    // flat lay to model, Indian traditional wear. One Agent run; OpenAI writes the prompt behind the scenes.
    id: 'outfit-studio',
    group: 'Try-on',
    label: 'Outfit Studio',
    short: 'Product, flat lay or Indian wear → on a model',
    icon: 'User',
    engine: 'FASHN Agent',
    blurb: 'Pick a workflow on the left, upload the model and the garments, then generate.',
    modes: OUTFIT_MODES,
    steps: ['Pick a workflow', 'Upload the model and garments', 'Choose style options and a background', 'Generate'],
    fields: [
      sel('mode', 'Workflow', OUTFIT_MODES.map((m) => ({ label: m.label, value: m.id })), 'product', { hidden: true }),
      img('model', 'Model', { hint: 'Optional — a model is created if empty' }),

      // Product to model
      img('top', 'Top', { hint: 'Shirt, t-shirt, jacket', showIf: inMode('product') }),
      img('topBack', 'Top · back', { pairWith: 'top', showIf: inMode('product') }),
      img('bottom', 'Bottom', { hint: 'Trousers, skirt, shorts', showIf: inMode('product') }),
      img('bottomBack', 'Bottom · back', { pairWith: 'bottom', showIf: inMode('product') }),
      img('dress', 'Dress / one-piece', { hint: 'Instead of top + bottom', showIf: inMode('product') }),
      img('dressBack', 'Dress · back', { pairWith: 'dress', showIf: inMode('product') }),

      // Flat lay to model
      img('flatA', 'Flat lay 1', { hint: 'Whole outfit or one piece', showIf: inMode('flat') }),
      img('flatABack', 'Flat lay 1 · back', { pairWith: 'flatA', showIf: inMode('flat') }),
      img('flatB', 'Flat lay 2', { hint: 'Optional second piece', showIf: inMode('flat') }),
      img('flatBBack', 'Flat lay 2 · back', { pairWith: 'flatB', showIf: inMode('flat') }),

      // Indian traditional wear
      sel('ethnicType', 'Outfit type', ETHNIC_TYPES, 'saree', { primary: true, showIf: inMode('indian') }),
      sel('drape', 'Saree drape', SAREE_DRAPES, SAREE_DRAPES[0].value, {
        primary: true,
        showIf: (v) => inMode('indian')(v) && (v.ethnicType || 'saree') === 'saree',
      }),
      sel('dupattaStyle', 'Dupatta style', DUPATTA_STYLES, DUPATTA_STYLES[0].value, {
        primary: true,
        showIf: (v) => inMode('indian')(v) && WITH_DUPATTA.includes(v.ethnicType),
      }),
      sel('indSetting', 'Setting', ETHNIC_SETTINGS, '', { primary: true, auto: 'Studio (default)', showIf: inMode('indian') }),
      img('ind', 'Main garment', { hint: 'Saree, lehenga, kurta set, sherwani', showIf: inMode('indian') }),
      img('indBack', 'Main garment · back', { pairWith: 'ind', showIf: inMode('indian') }),
      img('indTop', 'Blouse / choli / top', { hint: 'Only if it is a separate piece', showIf: inMode('indian') }),
      img('dupatta', 'Dupatta / stole', { hint: 'Only if it is a separate piece', showIf: inMode('indian') }),

      // All workflows
      img('shoes', 'Shoes / footwear', { hint: 'Optional' }),
      img('accessory', 'Accessory', { hint: 'Bag, hat, jewellery' }),
      img('background', 'Background', { hint: 'Photo of the setting' }),
      text('backgroundText', 'Background description', { placeholder: 'e.g. plain light-grey studio, soft daylight' }),
      text('notes', 'Styling notes', { placeholder: 'e.g. tuck in the shirt, full body, front view' }),
      sel('resolution', 'Resolution', RES_AGENT, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      sel('aspect_ratio', 'Aspect ratio', AR_AGENT, '3:4', { auto: 'Auto' }),
    ],
    extraLabel: 'at least one garment photo',
    extraCheck: (v) => modeOf(v).pieces.some((k) => !!v[k]),
    maxPhotos: MAX_AGENT_PHOTOS,
    validate: outfitProblems,
    credits: (v) => agentCostPerImage(v.generation_mode, v.resolution),
    costNote: 'per image',
    run: async (v, ctx) => {
      const m = modeOf(v);
      const labels = [];
      const images = [];
      const add = (label, x) => {
        if (x?.src) {
          labels.push(label);
          images.push(x.src);
        }
      };
      add('model photo', v.model);
      m.slots(v).forEach(([label, x]) => add(label, x));
      add('background photo', v.background);
      if (images.length > MAX_AGENT_PHOTOS) throw new FashnError({ code: 'TooManyPhotos', message: 'At most 6 photos per run' });
      const hasBack = m.pairs.some(([, back]) => !!v[back]);

      const bg = v.backgroundText?.trim();
      const instruction = [
        v.model ? '' : 'No model photo was given: create a suitable fashion model.',
        ...m.instruct(v),
        hasBack
          ? 'Images labelled BACK view show the back of the same garment as the FRONT image. Use them only to reproduce back details (print, cut, closures, length). Show the model from the front unless the styling notes ask for the back.'
          : '',
        v.background ? 'Place the model in the setting from the background photo.' : '',
        bg ? `Background: ${bg}` : '',
        v.notes?.trim() ? `Styling notes: ${v.notes.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      ctx.onStatus?.('Understanding your photos…');
      const { prompt } = await writePrompt({ labels, images, instruction, signal: ctx.signal });
      ctx.onStatus?.('Creating your look…');
      const out = await agentJob(
        { prompt, images, resolution: v.resolution, generation_mode: v.generation_mode, aspect_ratio: v.aspect_ratio || undefined },
        ctx
      );
      return { ...out, prompt };
    },
  },
  {
    id: 'tryon-max',
    group: 'Try-on',
    label: 'Try-On Max',
    short: 'Best quality · garments, shoes, bags',
    icon: 'User',
    engine: 'FASHN',
    blurb: 'Deterministic try-on for any wearable item, including shoes, hats, jewellery and bags. Supports a short editing prompt.',
    steps: ['Upload the model photo', 'Upload the garment or accessory', 'Optional: a short instruction, e.g. "tuck in shirt"', 'Generate'],
    fields: [
      img('model', 'Model image', { required: true, hint: 'Person to dress', section: 'Step 1 · Add your photos' }),
      img('product', 'Product image', { required: true, hint: 'Garment, shoes, bag, jewellery…' }),
      text('prompt', 'Optional instruction', { placeholder: 'e.g. tuck in shirt, roll up sleeves', section: 'Step 2 · Options' }),
      sel('resolution', 'Resolution', RES, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      countField(),
      seedField,
    ],
    credits: (v) => tryonCost(v.generation_mode, v.resolution, v.num_images),
    bulk: { rows: 'model', cols: 'product' },
    run: (v, ctx) =>
      fashnRun(
        'tryon-max',
        {
          model_image: srcOf(v.model),
          product_image: srcOf(v.product),
          prompt: v.prompt?.trim(),
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          num_images: v.num_images,
          seed: v.seed,
          output_format: 'png',
        },
        ctx
      ),
  },
  {
    id: 'tryon-v1-6',
    group: 'Try-on',
    label: 'Try-On v1.6 (fast, tops/bottoms)',
    short: 'Fast · 1 credit per image',
    icon: 'Zap',
    engine: 'FASHN',
    blurb: 'Lightweight try-on for real-time e-commerce. Clothing only (tops, bottoms, one-pieces) — use Try-On Max for shoes or accessories.',
    steps: ['Upload the model photo', 'Upload the garment (flat-lay or on-model)', 'Pick the category', 'Generate'],
    fields: [
      img('model', 'Model image', { required: true }),
      img('garment', 'Garment image', { required: true }),
      sel('category', 'Category', ['auto', 'tops', 'bottoms', 'one-pieces'], 'auto'),
      sel('garment_photo_type', 'Garment photo type', ['auto', 'flat-lay', 'model'], 'auto'),
      sel('mode', 'Mode', ['performance', 'balanced', 'quality'], 'balanced'),
      num('num_samples', 'Samples', 1, 4, 1),
      seedField,
    ],
    credits: (v) => v.num_samples,
    bulk: { rows: 'model', cols: 'garment' },
    run: (v, ctx) =>
      fashnRun(
        'tryon-v1.6',
        {
          model_image: srcOf(v.model),
          garment_image: srcOf(v.garment),
          category: v.category,
          garment_photo_type: v.garment_photo_type,
          mode: v.mode,
          num_samples: v.num_samples,
          seed: v.seed,
          output_format: 'png',
        },
        ctx
      ),
  },

  /* ---------- Models ---------- */
  {
    id: 'product-to-model',
    group: 'Models',
    label: 'Product → model',
    short: 'Create a model wearing the product',
    icon: 'IdCard',
    engine: 'FASHN',
    blurb: 'Generates a new person wearing your product. Good when you have no model photo. Keeps the product, not the reference pose or background.',
    steps: ['Upload the product photo', 'Optional: pose/environment reference or a backdrop', 'Describe the model if needed', 'Generate'],
    fields: [
      img('product', 'Product image', { required: true, hint: 'Clothing, shoes, bags, accessories' }),
      img('image_prompt', 'Pose / environment reference', { hint: 'Optional' }),
      text('prompt', 'Model description', { placeholder: 'e.g. man with tattoos, studio background' }),
      sel('aspect_ratio', 'Aspect ratio', AR_PRODUCT, '3:4', { auto: 'Auto (from product)' }),
      sel('resolution', 'Resolution', RES, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      img('background_reference', 'Backdrop photo', { hint: 'Optional — used as background' }),
      countField(),
    ],
    credits: (v) => tryonCost(v.generation_mode, v.resolution, v.num_images),
    run: (v, ctx) =>
      fashnRun(
        'product-to-model',
        {
          product_image: srcOf(v.product),
          image_prompt: srcOf(v.image_prompt),
          prompt: v.prompt?.trim(),
          aspect_ratio: v.aspect_ratio,
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          background_reference: srcOf(v.background_reference),
          num_images: v.num_images,
          output_format: 'png',
        },
        ctx
      ),
  },
  {
    id: 'model-swap',
    group: 'Models',
    label: 'Model swap',
    short: 'Change face, skin tone, hair',
    icon: 'RefreshCw',
    engine: 'FASHN',
    blurb: 'Keeps the outfit, pose and styling, and changes the model’s identity. Useful for diverse catalogues from one shoot.',
    steps: ['Upload a model photo already wearing the outfit', 'Describe the new model (optional)', 'Generate'],
    fields: [
      img('model', 'Model image', { required: true }),
      text('prompt', 'New model description', { placeholder: 'e.g. Asian woman with blue hair' }),
      sel('resolution', 'Resolution', RES, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      countField(),
    ],
    credits: (v) => tryonCost(v.generation_mode, v.resolution, v.num_images),
    run: (v, ctx) =>
      fashnRun(
        'model-swap',
        {
          model_image: srcOf(v.model),
          prompt: v.prompt?.trim(),
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          num_images: v.num_images,
          output_format: 'png',
        },
        ctx
      ),
  },
  {
    id: 'model-create',
    group: 'Models',
    label: 'Create model (text)',
    short: 'Generate a fashion model',
    icon: 'CirclePlus',
    engine: 'FASHN',
    blurb: 'Generate a fashion model from a text description, optionally guided by a pose or composition reference.',
    steps: ['Describe the model', 'Optional: a pose/composition reference', 'Pick the frame and generate'],
    fields: [
      text('prompt', 'Describe the model', { required: true, multiline: true, placeholder: 'e.g. young woman, short curly hair, confident pose, studio' }),
      img('image_reference', 'Pose / composition reference', { hint: 'Optional' }),
      sel('aspect_ratio', 'Aspect ratio', AR_CREATE, '3:4'),
      sel('resolution', 'Resolution', RES, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      countField(),
    ],
    credits: (v) => tryonCost(v.generation_mode, v.resolution, v.num_images),
    run: (v, ctx) =>
      fashnRun(
        'model-create',
        {
          prompt: v.prompt.trim(),
          image_reference: srcOf(v.image_reference),
          aspect_ratio: v.aspect_ratio,
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          num_images: v.num_images,
          output_format: 'png',
        },
        ctx
      ),
  },

  /* ---------- Tools ---------- */
  {
    id: 'agent',
    group: 'Tools',
    label: 'Agent (prompt)',
    short: 'Multi-image prompt editing',
    icon: 'Sparkles',
    engine: 'Agent',
    blurb: 'The same engine as the app.fashn.ai Agent. Write what you want with up to 6 images; refer to them as "image 1" … "image 6".',
    steps: ['Upload up to 6 images (optional)', 'Pick a preset, or write your own prompt', 'Choose resolution and quality', 'Generate'],
    presets: true,
    fields: [
      imgs('images', 'Images (optional, up to 6)', 6),
      text('prompt', 'Prompt', { required: true, multiline: true, max: 10000, placeholder: 'Describe the result. e.g. “Put the garment from image 2 on the model in image 1…”' }),
      sel('resolution', 'Resolution', RES_AGENT, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      sel('aspect_ratio', 'Aspect ratio', AR_AGENT, '', { auto: 'Auto (agent decides)' }),
    ],
    credits: (v) => agentCostPerImage(v.generation_mode, v.resolution),
    costNote: 'per output image',
    run: (v, ctx) =>
      agentJob(
        {
          prompt: v.prompt.trim(),
          images: v.images.map(srcOf),
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          aspect_ratio: v.aspect_ratio || undefined,
        },
        ctx
      ),
  },
  {
    id: 'upscale',
    group: 'Tools',
    label: 'Upscale',
    short: 'Sharpen to 2K–4K',
    icon: 'Maximize2',
    engine: 'Agent',
    blurb: 'Upscales an existing image through the Agent, keeping composition, face, garment and colour unchanged.',
    steps: ['Upload the image to upscale', 'Pick the target size', 'Generate'],
    fields: [
      img('image', 'Image to upscale', { required: true }),
      sel('resolution', 'Target resolution', ['2k', '3k', '4k'], '4k'),
      sel('generation_mode', 'Quality', GEN, 'quality'),
    ],
    credits: (v) => agentCostPerImage(v.generation_mode, v.resolution),
    costNote: 'per output image (+1 for the upscale step)',
    run: (v, ctx) =>
      agentJob(
        {
          prompt: `Upscale the image to ${v.resolution} resolution. Keep every detail, texture, colour, face, pose and garment exactly as in the original. Do not change the composition.`,
          images: [srcOf(v.image)],
          resolution: v.resolution,
          generation_mode: v.generation_mode,
        },
        ctx
      ),
  },
  {
    id: 'background',
    group: 'Tools',
    label: 'Change background',
    short: 'Photo or description',
    icon: 'ImageIcon',
    engine: 'Agent',
    blurb: 'Places a subject into a new setting, either from a background photo or from a text description.',
    steps: ['Upload the subject photo', 'Upload a background photo — or describe it', 'Generate'],
    extraLabel: 'a background photo or description',
    extraCheck: (v) => !!(v.subject && (v.background || v.description?.trim())),
    fields: [
      img('subject', 'Subject photo', { required: true }),
      img('background', 'Background photo', { hint: 'Optional if you describe it' }),
      text('description', 'Background description', { placeholder: 'e.g. marble showroom, soft daylight' }),
      sel('resolution', 'Resolution', RES_AGENT, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
    ],
    credits: (v) => agentCostPerImage(v.generation_mode, v.resolution),
    costNote: 'per output image',
    run: (v, ctx) => {
      const desc = v.description?.trim();
      const bg = srcOf(v.background);
      let prompt = bg
        ? 'Replace the background of the subject in image 1 with the setting shown in image 2. Keep the subject, pose, face, outfit and product details exactly unchanged. Match lighting and perspective.'
        : `Replace the background of the subject in image 1 with: ${desc}. Keep the subject, pose, face, outfit and product details exactly unchanged. Match lighting and perspective.`;
      if (bg && desc) prompt += ` Setting notes: ${desc}.`;
      return agentJob(
        { prompt, images: [srcOf(v.subject), bg].filter(Boolean), resolution: v.resolution, generation_mode: v.generation_mode },
        ctx
      );
    },
  },
  {
    id: 'edit',
    group: 'Tools',
    label: 'Edit (freeform)',
    short: 'Pose, accessories, lighting fixes',
    icon: 'Pencil',
    engine: 'FASHN',
    blurb: 'Describe a change to one image: pose or view, add an accessory, adjust lighting. Identity and product are preserved.',
    steps: ['Upload the image', 'Describe the change', 'Generate'],
    fields: [
      img('image', 'Image', { required: true }),
      text('prompt', 'What to change', { required: true, multiline: true, placeholder: 'e.g. turn the model to a three-quarter view, add a leather belt' }),
      sel('resolution', 'Resolution', RES, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      countField(),
    ],
    credits: (v) => tryonCost(v.generation_mode, v.resolution, v.num_images),
    run: (v, ctx) =>
      fashnRun(
        'edit',
        {
          image: srcOf(v.image),
          prompt: v.prompt.trim(),
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          num_images: v.num_images,
          output_format: 'png',
        },
        ctx
      ),
  },
  {
    id: 'reframe',
    group: 'Tools',
    label: 'Reframe (aspect ratio)',
    short: 'Expand or crop to a new ratio',
    icon: 'Maximize',
    engine: 'FASHN',
    blurb: 'Changes the aspect ratio by smart expansion (outpainting) or cropping. For example, make a 1:1 image 3:4.',
    steps: ['Upload the image', 'Pick the target ratio', 'Generate'],
    fields: [
      img('image', 'Image', { required: true }),
      sel('aspect_ratio', 'Target aspect ratio', AR_REFRAME, '3:4'),
      sel('resolution', 'Resolution', RES, '1k'),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      countField(),
    ],
    credits: (v) => tryonCost(v.generation_mode, v.resolution, v.num_images),
    run: (v, ctx) =>
      fashnRun(
        'reframe',
        {
          image: srcOf(v.image),
          aspect_ratio: v.aspect_ratio,
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          num_images: v.num_images,
          output_format: 'png',
        },
        ctx
      ),
  },
  {
    id: 'background-remove',
    group: 'Tools',
    label: 'Remove background',
    short: 'Transparent PNG cutout',
    icon: 'Copy',
    engine: 'FASHN',
    blurb: 'Cuts out the main subject as a transparent PNG. Fast, about 1 credit.',
    steps: ['Upload the image', 'Generate'],
    fields: [img('image', 'Image', { required: true, hint: 'At least 128 × 128 px' })],
    credits: () => 1,
    run: (v, ctx) => fashnRun('background-remove', { image: srcOf(v.image) }, ctx),
  },

  /* ---------- AI STUDIO (main flow) ---------- */
  {
    id: 'ai-studio',
    group: 'AI',
    label: 'AI Studio',
    short: 'OpenAI writes the prompt · FASHN renders',
    icon: 'Star',
    engine: 'OpenAI → FASHN Agent',
    blurb: 'Give any mix of inputs: model, garment(s), shoes, background photo or description. OpenAI reads them and writes the prompt; FASHN renders one output. Then ask for a modification.',
    steps: [
      'Add what you have: model, garment(s), shoes, background — any combination',
      'Keep "AI writes the prompt", or switch to writing your own',
      'Generate — one output image',
      'Want a modification? Describe it under the result and apply it',
    ],
    supportsChange: true,
    fields: [
      img('model', 'Model photo', {
        section: 'Step 1 · Add your photos (any combination)',
        hint: 'Optional — without it the agent creates a model',
      }),
      imgs('garments', 'Garment photos (1–2)', 2, { hint: 'e.g. top + bottom, or one dress' }),
      img('shoes', 'Shoes or accessory', { hint: 'Optional' }),
      img('background', 'Background photo', { hint: 'Optional' }),
      text('backgroundText', 'Background description', { placeholder: 'e.g. marble showroom, soft daylight' }),
      sel(
        'mode',
        'How should the prompt be written?',
        [
          { label: 'AI writes the prompt (recommended)', value: 'ai' },
          { label: 'I write the prompt myself', value: 'manual' },
        ],
        'ai',
        { section: 'Step 2 · Prompt' }
      ),
      text('instruction', 'Extra instructions for the AI', {
        showIf: (v) => v.mode !== 'manual',
        multiline: true,
        placeholder: 'e.g. full body, front view, editorial pose',
      }),
      text('prompt', 'Your prompt', {
        showIf: (v) => v.mode === 'manual',
        multiline: true,
        max: 10000,
        placeholder: 'Refer to inputs in order: image 1 = model, then garments, shoes, background. e.g. "Put the garment from image 2 on the model in image 1…"',
      }),
      sel('resolution', 'Resolution', RES_AGENT, '1k', { section: 'Step 3 · Output settings' }),
      sel('generation_mode', 'Quality', GEN, 'balanced'),
      sel('aspect_ratio', 'Aspect ratio', AR_AGENT, '3:4', { auto: 'Auto' }),
      // Hidden: filled by "Apply change" on a result.
      img('baseImage', 'Previous result', { hidden: true }),
      text('previousPrompt', 'Previous prompt', { hidden: true }),
      text('change', 'Change request', { hidden: true }),
    ],
    extraLabel: 'at least one input (model, garment, shoes, background or description), and a prompt in manual mode',
    extraCheck: (v) => {
      const hasInput = !!(v.model || v.garments?.length || v.shoes || v.background || v.backgroundText?.trim() || v.baseImage);
      const hasText = v.mode !== 'manual' || !!(v.prompt?.trim() || v.change?.trim());
      return hasInput && hasText;
    },
    credits: (v) => agentCostPerImage(v.generation_mode, v.resolution),
    costNote: 'credits',
    run: async (v, ctx) => {
      const base = srcOf(v.baseImage);
      const labels = [];
      const images = [];
      const add = (label, src) => {
        if (src) {
          labels.push(label);
          images.push(src);
        }
      };
      if (base) add('previous result (edit this image)', base);
      add('model photo', srcOf(v.model));
      (v.garments ?? []).forEach((g, i) => add(`garment ${i + 1}`, g.src));
      add('shoes or accessory', srcOf(v.shoes));
      add('background photo', srcOf(v.background));

      // Manual prompts go straight to the Agent, except a change request, which the AI revises.
      const useAI = v.mode !== 'manual' || (!!base && !!v.change?.trim());
      let prompt = v.prompt?.trim() ?? '';
      let notes = '';

      if (useAI) {
        const bgText = v.backgroundText?.trim();
        const instruction = [v.instruction?.trim(), bgText ? `Background description: ${bgText}` : '']
          .filter(Boolean)
          .join('\n');
        ctx.onStatus?.('Understanding your photos…');
        ({ prompt, notes } = await writePrompt({
          labels,
          images,
          instruction,
          change: base ? v.change : '',
          previousPrompt: base ? v.previousPrompt : '',
          signal: ctx.signal,
        }));
      } else if (v.backgroundText?.trim()) {
        prompt = `${prompt} Background: ${v.backgroundText.trim()}.`;
      }

      ctx.onStatus?.('Creating your image…');
      const out = await agentJob(
        {
          prompt,
          images,
          resolution: v.resolution,
          generation_mode: v.generation_mode,
          aspect_ratio: v.aspect_ratio || undefined,
        },
        ctx
      );
      return { ...out, prompt, notes };
    },
  },

  /* ---------- Engines ---------- */
  {
    id: 'openai-edit',
    group: 'Engines',
    label: 'OpenAI image edit',
    short: 'gpt-image-1 · needs OPENAI_API_KEY',
    icon: 'Globe',
    engine: 'OpenAI',
    blurb: 'Edits or combines images with OpenAI gpt-image-1. Billed by OpenAI, not FASHN. Needs OPENAI_API_KEY in .env (restart the dev server after adding it).',
    steps: ['Upload 1–4 images', 'Describe the edit', 'Pick size and quality', 'Generate'],
    fields: [
      imgs('images', 'Images', 4, { required: true }),
      text('prompt', 'Prompt', { required: true, multiline: true, placeholder: 'e.g. Dress the person in image 1 in the jacket from image 2, keep everything else the same' }),
      sel('size', 'Size', ['auto', '1024x1024', '1024x1536', '1536x1024'], 'auto'),
      sel('quality', 'Quality', ['low', 'medium', 'high'], 'medium'),
      num('n', 'Images', 1, 4, 1),
    ],
    credits: () => null,
    costNote: 'billed by OpenAI',
    run: async (v, ctx) => {
      ctx.onStatus?.('Editing your images…');
      const images = await editWithOpenAI({
        images: v.images.map(srcOf),
        prompt: v.prompt.trim(),
        size: v.size,
        quality: v.quality,
        n: v.n,
        signal: ctx.signal,
      });
      return { images, credits: null, jobIds: [] };
    },
  },
];

// Sidebar shows only the main flows. Other workflows stay in WORKFLOWS (add their ids here to show them).
export const NAV_IDS = ['ai-studio', 'outfit-studio', 'upscale', 'background-remove'];
export const NAV_GROUPS = ['AI', 'Try-on', 'Tools'];

export const findWorkflow = (id) => WORKFLOWS.find((w) => w.id === id);

export function defaultValues(wf) {
  return Object.fromEntries(
    wf.fields.map((f) => [f.key, f.type === 'images' ? [] : f.type === 'text' ? '' : f.type === 'image' ? null : (f.default ?? null)])
  );
}

/** Labels of required inputs that are still empty. */
export function missingFields(wf, v) {
  const miss = [];
  for (const f of wf.fields) {
    if (!f.required) continue;
    const x = v[f.key];
    const ok =
      f.type === 'image' ? !!x : f.type === 'images' ? (x || []).length > 0 : f.type === 'text' ? !!String(x ?? '').trim() : x != null && x !== '';
    if (!ok) miss.push(f.label);
  }
  if (wf.extraCheck && !wf.extraCheck(v)) miss.push(wf.extraLabel || 'a required input');
  if (wf.validate) miss.push(...wf.validate(v));
  return miss;
}

export const PRESET_GROUPS = [...new Set(PRESETS.map((p) => p.group))].map((g) => ({
  label: g,
  items: PRESETS.filter((p) => p.group === g),
}));
