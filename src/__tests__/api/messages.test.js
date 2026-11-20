import { friendlyError, friendlyStatus } from '@/lib/messages.js';

describe('friendlyError', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

  it('maps known codes to plain wording', () => {
    expect(friendlyError({ code: 'OutOfCredits' }).title).toBe('Not enough credits');
    expect(friendlyError({ code: 'TooManyPhotos' }).title).toBe('Too many photos');
  });

  it('treats a 401 as setup needed', () => {
    expect(friendlyError({ status: 401 }).title).toBe('Setup needed');
  });

  it('falls back for unknown errors', () => {
    expect(friendlyError(new Error('boom')).title).toBe('Something went wrong');
  });

  it('never puts raw technical text in the message', () => {
    const f = friendlyError({ code: 'RateLimitExceeded', message: 'POST /v1/run 429' });
    expect(`${f.title} ${f.detail}`).not.toMatch(/v1\/run|429/);
  });
});

describe('friendlyStatus', () => {
  it('translates job states', () => {
    expect(friendlyStatus('in_queue')).toBe('Waiting in line…');
    expect(friendlyStatus('whatever')).toBe('Working…');
  });
});
