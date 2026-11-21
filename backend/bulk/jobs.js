// Runs bulk generation jobs with a fixed concurrency limit. Analysis and generation are injected,
// so the runner itself never calls an AI service and can be tested without credits.
import crypto from 'node:crypto';

const now = () => new Date().toISOString();

/** Turns validated mapping rows into job records. */
export function planJobs(rows) {
  return rows.map((r) => ({
    id: crypto.randomUUID(),
    jobId: r.jobId,
    row: r.row,
    category: r.category,
    input: r.input,
    outputName: r.outputName,
    status: 'queued',
    instruction: r.input.prompt_instruction || '',
    analysis: null,
    prompt: null,
    predictionId: null,
    outputs: [],
    attempts: 0,
    timings: {},
    error: null,
    createdAt: now(),
    startedAt: null,
    completedAt: null,
    history: [],
  }));
}

export function createRunner({ deps, save, concurrency = 1 }) {
  const running = new Set();

  async function runJob(batch, job) {
    const started = Date.now();
    job.startedAt = now();
    job.error = null;
    job.attempts += 1;
    try {
      if (!job.analysis || job.analysisFor !== job.instruction) {
        job.status = 'analysing';
        save(batch);
        const t0 = Date.now();
        job.analysis = await deps.analyse({ batch, job });
        job.analysisFor = job.instruction;
        job.prompt = job.analysis?.prompt ?? null;
        job.timings.analysisMs = Date.now() - t0;
        save(batch);
      }
      if (job.analysis?.dryRun) {
        job.status = 'dry_run';
        return;
      }
      job.status = 'generating';
      save(batch);
      const t1 = Date.now();
      const result = await deps.generate({ batch, job });
      job.predictionId = result.predictionId;
      job.outputs = result.outputs;
      job.timings.generationMs = Date.now() - t1;
      job.status = 'completed';
    } catch (e) {
      job.status = 'failed';
      job.error = { code: e.code ?? 'Error', message: e.message ?? 'The job failed.' };
    } finally {
      job.completedAt = now();
      job.timings.totalMs = Date.now() - started;
      save(batch);
    }
  }

  async function pump(batch, queue) {
    while (queue.length) {
      const job = queue.shift();
      await runJob(batch, job);
    }
  }

  /** Runs every queued job of the batch. A batch that is already running is left alone. */
  async function start(batch) {
    if (running.has(batch.id)) return false;
    running.add(batch.id);
    const queue = batch.jobs.filter((j) => j.status === 'queued');
    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => pump(batch, queue)));
    } finally {
      running.delete(batch.id);
    }
    return true;
  }

  /**
   * Regenerates one job. The previous outputs move into history and are never overwritten.
   * The analysis is reused unless the instruction changed.
   */
  async function regenerate(batch, job, { instruction } = {}) {
    if (running.has(batch.id)) return false;
    if (job.outputs.length) {
      job.history.push({ at: now(), outputs: job.outputs, predictionId: job.predictionId, prompt: job.prompt, instruction: job.instruction });
    }
    if (typeof instruction === 'string') job.instruction = instruction.slice(0, 500);
    job.input.prompt_instruction = job.instruction;
    job.outputs = [];
    job.predictionId = null;
    job.status = 'queued';
    job.regeneratedAt = now();
    save(batch);
    running.add(batch.id);
    try {
      await runJob(batch, job);
    } finally {
      running.delete(batch.id);
    }
    return true;
  }

  return { start, regenerate };
}

/** Counts for the dashboard. */
export function summarize(jobs) {
  const count = (s) => jobs.filter((j) => j.status === s).length;
  const totalMs = jobs.reduce((s, j) => s + (j.timings.totalMs ?? 0), 0);
  return {
    total: jobs.length,
    queued: count('queued'),
    processing: count('analysing') + count('generating'),
    completed: count('completed'),
    failed: count('failed'),
    dryRun: count('dry_run'),
    processingMs: totalMs,
  };
}
