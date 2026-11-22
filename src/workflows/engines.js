// Workflow registry for the tools the AI Studio chat calls directly: Upscale and Remove background.
// The chat itself (assistant, prompts, quality check) lives in features/chat and backend/agents.
import { api, sleep, toFashnError, FashnError, runAgent, pollAgent, extractAgentResults, agentCostPerImage } from '@/api/fashn.js';
import { FASHN_RUN, FASHN_STATUS } from '@/api/endpoints.js';
import { friendlyStatus } from '@/lib/messages.js';

/* Low-level FASHN helpers */

const srcOf = (v) => v?.src;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

async function startRun(model_name, inputs, signal) {
  const data = await api(FASHN_RUN, { method: 'POST', body: { model_name, inputs: clean(inputs) }, signal });
  if (data?.error) throw toFashnError(data);
  if (!data?.id) throw toFashnError(data ?? 'No job id returned');
  return data.id;
}

async function pollRun(id, { signal, onUpdate }) {
  for (;;) {
    const d = await api(FASHN_STATUS(id), { signal });
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


/* Option lists */

const GEN = ['fast', 'balanced', 'quality'];
const RES_AGENT = ['1k', '2k', '3k', '4k'];

/* Field builders */

const img = (key, label, o = {}) => ({ key, label, type: 'image', ...o });
const sel = (key, label, list, def, { auto, ...o } = {}) => ({
  key,
  label,
  type: 'select',
  options: [...(auto ? [{ label: auto, value: '' }] : []), ...list.map((v) => (typeof v === 'string' ? { label: v, value: v } : v))],
  default: def,
  ...o,
});

/* Tools */

export const WORKFLOWS = [
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
          prompt:
            `Upscale this image to ${v.resolution} resolution. This is an upscale only: do not redraw, restyle, re-pose, re-light or re-crop anything. The person must stay the same person: the face, skin tone, facial features, hair, body shape and expression must match the input exactly, with no new or altered facial features. Keep the garment, colours, background and composition exactly as they are. Only add real fine detail (fabric weave, embroidery, zari, hair, skin texture) and remove blur and compression artefacts. Do not add or remove any element.`,
          images: [srcOf(v.image)],
          resolution: v.resolution,
          generation_mode: v.generation_mode,
        },
        ctx
      ),
  },,
  {
    id: 'background-remove',
    group: 'Tools',
    label: 'Remove background',
    short: 'Transparent PNG cutout',
    icon: 'Copy',
    engine: 'Studio',
    blurb: 'Cuts out the main subject as a transparent PNG. Fast, about 1 credit.',
    steps: ['Upload the image', 'Generate'],
    fields: [img('image', 'Image', { required: true, hint: 'At least 128 × 128 px' })],
    credits: () => 1,
    run: (v, ctx) => fashnRun('background-remove', { image: srcOf(v.image) }, ctx),
  },,
];

export const findWorkflow = (id) => WORKFLOWS.find((w) => w.id === id);
