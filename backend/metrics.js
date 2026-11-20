// In-memory performance metrics for FASHN generation jobs.
// Keeps the last MAX_JOBS jobs and MAX_REQUESTS individual API calls.
// Cleared on restart — this is a dev/diagnostic tool, not persistent storage.

const MAX_JOBS = 100;
const MAX_REQUESTS = 500;

const jobs = new Map(); // jobId -> JobRecord
const requests = []; // recent request log entries

export function logRequest({ endpoint, method, status, duration }) {
  requests.push({ endpoint, method, status, duration, ts: Date.now() });
  if (requests.length > MAX_REQUESTS) requests.splice(0, requests.length - MAX_REQUESTS);
}

function queueMs(job) {
  const started = job.polls.find((p) => p.status !== 'pending' && p.status !== 'queued');
  return started ? started.ts - job.startTime : null;
}

export const jobStore = {
  start(jobId, endpoint, startTime) {
    if (jobs.size >= MAX_JOBS) {
      const oldest = jobs.keys().next().value;
      jobs.delete(oldest);
    }
    jobs.set(jobId, { jobId, endpoint, startTime, polls: [], status: 'pending', completedAt: null, totalMs: null });
  },

  poll(jobId, status, pollMs) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.polls.push({ status, pollMs, ts: Date.now() });
    job.status = status ?? job.status;
    if (status === 'completed' || status === 'failed') {
      job.completedAt = Date.now();
      job.totalMs = job.completedAt - job.startTime;
    }
  },

  summary() {
    const jobList = [...jobs.values()].reverse();
    const done = jobList.filter((j) => j.status === 'completed' && j.totalMs != null);
    const avgMs = done.length ? Math.round(done.reduce((s, j) => s + j.totalMs, 0) / done.length) : null;
    return {
      stats: {
        totalJobs: jobList.length,
        completedJobs: done.length,
        averageCompletionMs: avgMs,
        averageCompletionMin: avgMs ? (avgMs / 60000).toFixed(2) : null,
      },
      jobs: jobList.map((j) => ({
        jobId: j.jobId,
        endpoint: j.endpoint,
        status: j.status,
        startedAt: new Date(j.startTime).toISOString(),
        completedAt: j.completedAt ? new Date(j.completedAt).toISOString() : null,
        totalMs: j.totalMs,
        pollCount: j.polls.length,
        queueMs: queueMs(j),
      })),
      recentRequests: requests.slice(-50),
    };
  },
};
