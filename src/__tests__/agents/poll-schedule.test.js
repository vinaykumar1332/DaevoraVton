import { POLL_SCHEDULE } from '@/api/fashn.js';

describe('job polling schedule', () => {
  it('polls every 3 seconds for the first minute, then every 5 seconds', () => {
    expect(POLL_SCHEDULE.fastMs).toBe(3000);
    expect(POLL_SCHEDULE.slowMs).toBe(5000);
    expect(POLL_SCHEDULE.fastWindowMs).toBe(60000);
  });

  it('gives up after six minutes', () => {
    expect(POLL_SCHEDULE.limitMs).toBe(6 * 60 * 1000);
  });
});
