// HTTP entry for the bulk module (mounted only on the local Express server, under /api/bulk).
import { send } from '../../api/_auth.js';
import { requireUser } from '../guard.js';
import { LIMITS, MAX_BULK_IMAGES, BULK_CONCURRENCY, BULK_LIVE } from './config.js';
import { extractImages, BulkError } from './zip.js';
import { parseCsv, parseXlsx, validateMapping } from './mapping.js';
import { createBatch, loadBatch, saveManifest } from './store.js';
import { createRunner, planJobs, summarize } from './jobs.js';
import { analyse, generate } from './engine.js';

const runner = createRunner({ deps: { analyse, generate }, save: saveManifest, concurrency: BULK_CONCURRENCY });
// Batches that are running share one in-memory copy, so a request never overwrites newer progress.
const live = new Map();
const batchFor = (id, owner) => {
  const held = live.get(id);
  if (held) return held.owner === owner ? held : null;
  return loadBatch(id, owner);
};

async function readRaw(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new BulkError('TooLarge', 'The upload is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const publicJob = (j) => ({
  id: j.id,
  jobId: j.jobId,
  row: j.row,
  status: j.status,
  category: j.category,
  input: j.input,
  instruction: j.instruction,
  prompt: j.prompt,
  analysis: j.analysis && { reply: j.analysis.reply ?? null, dryRun: !!j.analysis.dryRun, reason: j.analysis.reason ?? null, photoNotes: j.analysis.photoNotes ?? [] },
  predictionId: j.predictionId,
  outputs: j.outputs,
  attempts: j.attempts,
  timings: j.timings,
  error: j.error,
  createdAt: j.createdAt,
  startedAt: j.startedAt,
  completedAt: j.completedAt,
  regeneratedAt: j.regeneratedAt ?? null,
  history: j.history.map((h) => ({ at: h.at, outputs: h.outputs, prompt: h.prompt, instruction: h.instruction })),
});

const publicBatch = (b) => ({
  id: b.id,
  name: b.name,
  createdAt: b.createdAt,
  limits: { maxImages: MAX_BULK_IMAGES },
  live: BULK_LIVE,
  images: b.images,
  rejected: b.rejected,
  mapping: b.mapping && {
    source: b.mapping.source,
    errors: b.mapping.errors,
    skipped: b.mapping.skipped,
    jobCount: b.mapping.jobs.length,
    jobs: b.mapping.jobs.map((j) => ({ jobId: j.jobId, row: j.row, input: j.input, category: j.category, outputName: j.outputName })),
  },
  summary: summarize(b.jobs),
  jobs: b.jobs.map(publicJob),
});

/** Routes /api/bulk/... requests. Every route needs a signed-in user, and batches are private to that user. */
export async function bulkHandler(req, res) {
  const url = new URL(req.url, 'http://local');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','bulk', ...]
  const session = requireUser(req, res, 'bulk');
  if (!session) return;
  const owner = session.username;

  try {
    if (req.method === 'POST' && parts.length === 3 && parts[2] === 'batches') {
      const buffer = await readRaw(req, LIMITS.zipBytes + 1);
      const { images, rejected } = await extractImages(buffer);
      if (!images.length) throw new BulkError('NoImages', 'The ZIP has no usable JPG, PNG or WEBP images.');
      const batch = createBatch({ owner, name: url.searchParams.get('name'), images, rejected });
      return send(res, 201, publicBatch(batch));
    }

    const batchId = parts[3];
    const batch = batchId ? batchFor(batchId, owner) : null;
    if (!batch) return send(res, 404, { error: { name: 'NotFound', message: 'That batch was not found.' } });

    if (req.method === 'GET' && parts.length === 4) return send(res, 200, publicBatch(batch));

    if (req.method === 'POST' && parts.length === 5 && parts[4] === 'mapping') {
      const type = url.searchParams.get('type') ?? 'json';
      const body = await readRaw(req, LIMITS.mappingBytes);
      let rows;
      if (type === 'json') {
        const data = JSON.parse(body.toString() || '{}');
        if (!Array.isArray(data.rows)) throw new BulkError('BadMapping', 'Send { "rows": [...] } for a manual mapping.');
        rows = data.rows;
      } else if (type === 'csv') rows = parseCsv(body.toString('utf8'));
      else if (type === 'xlsx') rows = await parseXlsx(body);
      else throw new BulkError('BadMapping', 'type must be csv, xlsx or json.');
      const names = batch.images.map((i) => i.name);
      const result = validateMapping(rows, names);
      batch.mapping = { source: type, errors: result.errors, skipped: result.skipped, jobs: result.jobs };
      saveManifest(batch);
      return send(res, 200, publicBatch(batch));
    }

    if (req.method === 'POST' && parts.length === 5 && parts[4] === 'start') {
      if (!batch.mapping?.jobs?.length) throw new BulkError('NoMapping', 'Upload a valid mapping before starting.');
      if (!batch.jobs.length) batch.jobs = planJobs(batch.mapping.jobs);
      saveManifest(batch);
      live.set(batch.id, batch);
      runner.start(batch).catch(() => {}).finally(() => live.delete(batch.id));
      return send(res, 202, publicBatch(batch));
    }

    if (req.method === 'POST' && parts.length === 7 && parts[5] && parts[6] === 'regenerate') {
      const job = batch.jobs.find((j) => j.id === parts[5]);
      if (!job) return send(res, 404, { error: { name: 'NotFound', message: 'That job was not found.' } });
      const body = JSON.parse((await readRaw(req, 64 * 1024)).toString() || '{}');
      live.set(batch.id, batch);
      runner.regenerate(batch, job, { instruction: body.instruction }).catch(() => {}).finally(() => live.delete(batch.id));
      return send(res, 202, publicBatch(batch));
    }

    return send(res, 404, { error: { name: 'NotFound', message: 'Unknown bulk route.' } });
  } catch (e) {
    if (e instanceof BulkError) return send(res, e.status ?? 400, { error: { name: e.code, message: e.message } });
    if (e instanceof SyntaxError) return send(res, 400, { error: { name: 'BadRequest', message: 'The request body is not valid JSON.' } });
    return send(res, 500, { error: { name: 'BulkError', message: 'The bulk request failed.' } });
  }
}
