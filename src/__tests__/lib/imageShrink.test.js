import { fitPayload } from '@/lib/imageShrink.js';

describe('fitPayload', () => {
  it('returns a small body unchanged', async () => {
    const body = { prompt: 'red dress', images: ['data:image/jpeg;base64,AAA'] };
    expect(await fitPayload(body)).toBe(body);
  });

  it('leaves non-image text alone even when the body is over budget', async () => {
    const body = { prompt: 'x'.repeat(5000), images: [] };
    expect(await fitPayload(body, 1000)).toEqual(body);
  });
});
