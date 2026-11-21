// Frontend ↔ backend API client.
// All AI logic (OpenAI, FASHN job starts) lives on the server.
// The frontend sends data here and receives decisions / job IDs back.
import { FashnError } from './fashn.js';
import { CHAT_TURN, CHAT_ENHANCE, JOB_AGENT, PHOTO_ANALYZE, QUALITY_SCORE } from './endpoints.js';
import { fitPayload } from '@/lib/imageShrink.js';

const TIMEOUT_MS = 90_000;
const RETRY_STATUS = new Set([502, 503, 504]);

async function send(url, payload, signal) {
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), TIMEOUT_MS);
  const onAbort = () => timer.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: timer.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timer.signal.aborted) throw new FashnError({ status: 408, code: 'AgentTimeout', message: 'The request took too long.' });
    throw new FashnError({ status: 0, code: 'NetworkError', message: 'Could not reach the server.' });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function post(url, body, signal, { retry = 0 } = {}) {
  const payload = await fitPayload(body);
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await send(url, payload, signal);
    if (!RETRY_STATUS.has(res.status) || attempt >= retry) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new FashnError({ status: res.status, code: e.name || `Backend${res.status}`, message: e.message || res.statusText });
  }
  return data;
}

/**
 * Run a chat turn on the server.
 * OpenAI reads the photos + history, decides what to do, and builds the full engine prompt.
 * Returns the standard chatTurn shape plus:
 *   enginePrompt — the full prompt sent to FASHN (with house rules + view corrections added server-side)
 */
export async function backendChatTurn({ history, userText, photos, newCount, lastPrompt, hasPrevious, forcePrevious, photoMeta, signal }) {
  return post(CHAT_TURN, { history, userText, photos, newCount, lastPrompt, hasPrevious, forcePrevious, photoMeta }, signal);
}

/**
 * Rewrite a short user request into a clear, specific fashion instruction.
 * Returns { text }.
 */
export async function backendEnhanceRequest({ text, photoCount, signal }) {
  const data = await post(CHAT_ENHANCE, { text, photoCount }, signal, { retry: 1 });
  return data.text ?? text;
}

/**
 * Start a FASHN agent job on the server and return { jobId }.
 * The client then polls /fashn/v1/agent/status/:jobId for real-time progress updates.
 */
export async function backendStartAgentJob({ prompt, images, resolution, generation_mode, aspect_ratio, signal }) {
  return post(JOB_AGENT, { prompt, images, resolution, generation_mode, aspect_ratio }, signal);
}

/**
 * Quality check of a finished look against its inputs and request.
 * Returns { match, areas, problems }. Callers treat a failure as "no check", so the result still shows.
 */
export async function backendScoreLook({ inputs, output, request, brief, signal }) {
  return post(QUALITY_SCORE, { inputs, output, request, brief }, signal);
}

/**
 * Analyze a photo with GPT-4o Vision. Returns immediately with role/type/color/fabric/view.
 * Called right after upload — non-blocking, results stored locally and passed to chat turn.
 * Returns {} on any error so a failed analysis never blocks the user.
 */
export async function backendAnalyzePhoto({ src, signal }) {
  return post(PHOTO_ANALYZE, { src }, signal, { retry: 1 }).catch(() => ({}));
}
