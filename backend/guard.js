// Shared guard for the paid AI endpoints: signed-in user + a per-user request budget.
// The budget is in memory, so it is per warm serverless instance. It stops runaway loops and
// careless spend; it is not a hard global quota.
import { send, sessionFromReq } from '../api/_auth.js';

const WINDOW_MS = 60 * 1000;
const LIMITS = { chat: 40, job: 12, photo: 60, score: 60 };
const hits = new Map();

function overBudget(key, limit, now) {
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= limit) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** Returns the session, or sends 401 / 429 and returns null. */
export function requireUser(req, res, bucket) {
  const session = sessionFromReq(req);
  if (!session) {
    send(res, 401, { error: { name: 'SessionExpired', message: 'Please sign in again.' } }, { 'X-Session-Expired': '1' });
    return null;
  }
  if (overBudget(`${bucket}:${session.username}`, LIMITS[bucket], Date.now())) {
    send(res, 429, { error: { name: 'RateLimitExceeded', message: 'Too many requests. Wait a minute and try again.' } }, { 'Retry-After': '60' });
    return null;
  }
  return session;
}
