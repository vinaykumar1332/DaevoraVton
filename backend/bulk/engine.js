// The real analysis and generation steps for bulk jobs. They call the same code as AI Studio:
//   analysis   -> chatTurn (backend/agents/chat.js), the function behind the AI Studio chat
//   generation -> FASHN's direct run endpoint with the try-on model the Try-On Max workflow uses
// Both spend credits, so they only run when BULK_LIVE=1. Otherwise jobs finish as dry runs.
import { chatTurn } from '../agents/chat.js';
import { BULK_LIVE } from './config.js';
import { readImage } from './store.js';

const FASHN_RUN = 'https://api.fashn.ai/v1/run';
const FASHN_STATUS = (id) => `https://api.fashn.ai/v1/status/${encodeURIComponent(id)}`;
const POLL_MS = 3000;
const MAX_POLLS = 200; // about 10 minutes

const mimeOf = (name) => (/\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');

function dataUri(batch, name) {
  const bytes = readImage(batch.id, name);
  if (!bytes) throw Object.assign(new Error(`Image "${name}" is missing from the batch.`), { code: 'MissingImage' });
  return `data:${mimeOf(name)};base64,${bytes.toString('base64')}`;
}

export async function analyse({ batch, job }) {
  if (!BULK_LIVE) return { dryRun: true, prompt: null, reason: 'Live generation is off. Set BULK_LIVE=1 to run.' };
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw Object.assign(new Error('OPENAI_API_KEY is not set.'), { code: 'UnauthorizedAccess' });

  const photos = [{ id: 'model', src: dataUri(batch, job.input.model_image) }];
  if (job.input.product_image) photos.push({ id: 'garment', src: dataUri(batch, job.input.product_image) });
  const turn = await chatTurn({
    history: [],
    userText: job.instruction || 'Dress the model in this garment.',
    photos,
    newCount: photos.length,
    hasPrevious: false,
    openaiKey,
  });
  if (turn.action !== 'generate' || !turn.prompt) {
    throw Object.assign(new Error(turn.reply || 'The assistant did not produce a prompt for this job.'), { code: 'AnalysisNoPrompt' });
  }
  return { prompt: turn.prompt, enginePrompt: turn.enginePrompt, photoNotes: turn.photo_notes ?? [], reply: turn.reply };
}

export async function generate({ batch, job }) {
  if (!BULK_LIVE) throw Object.assign(new Error('Live generation is off.'), { code: 'LiveDisabled' });
  const key = process.env.FASHN_API_KEY;
  if (!key) throw Object.assign(new Error('FASHN_API_KEY is not set.'), { code: 'UnauthorizedAccess' });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

  const inputs = {
    model_image: dataUri(batch, job.input.model_image),
    product_image: dataUri(batch, job.input.product_image),
    prompt: (job.analysis?.prompt || '').slice(0, 500) || undefined,
    resolution: '1k',
    generation_mode: 'balanced',
    num_images: 1,
    output_format: 'png',
  };
  if (!inputs.prompt) delete inputs.prompt;

  const started = await fetch(FASHN_RUN, { method: 'POST', headers, body: JSON.stringify({ model_name: 'tryon-max', inputs }) });
  const data = await started.json().catch(() => null);
  if (!started.ok || !data?.id) {
    throw Object.assign(new Error('The generation could not be started.'), { code: `Upstream${started.status}` });
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await fetch(FASHN_STATUS(data.id), { headers });
    const s = await res.json().catch(() => null);
    if (s?.status === 'completed') {
      const outputs = Array.isArray(s.output) ? s.output : (s.output?.images ?? []);
      if (!outputs.length) throw Object.assign(new Error('No image was returned.'), { code: 'NoImageGenerated' });
      return { predictionId: data.id, outputs };
    }
    if (s?.status === 'failed' || s?.status === 'canceled') {
      throw Object.assign(new Error('The generation failed.'), { code: s?.error?.name || 'GenerationFailed' });
    }
  }
  throw Object.assign(new Error('The generation took too long.'), { code: 'Timeout' });
}
