import { shouldRetry, RETRY_DELAYS_MS } from '@/api/fashn.js';

describe('FASHN request retries', () => {
  it('retries reads on rate limits and server errors, up to three times', () => {
    expect(shouldRetry({ method: 'GET', status: 429, attempt: 0 })).toBe(true);
    expect(shouldRetry({ method: 'GET', status: 503, attempt: 2 })).toBe(true);
    expect(shouldRetry({ method: 'GET', status: 503, attempt: 3 })).toBe(false);
  });

  it('never retries a job start, even on a server error', () => {
    expect(shouldRetry({ method: 'POST', status: 503, attempt: 0 })).toBe(false);
    expect(shouldRetry({ method: 'POST', status: 429, attempt: 0 })).toBe(false);
  });

  it('does not retry client errors', () => {
    expect(shouldRetry({ method: 'GET', status: 404, attempt: 0 })).toBe(false);
  });

  it('waits 1 s, 2 s, then 4 s', () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
  });
});
