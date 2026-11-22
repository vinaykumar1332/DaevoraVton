import { preflight } from '@/agents/preflight.js';

const garment = (photo, extra = {}) => ({ photo, role: 'garment', view: 'front', ...extra });
const model = (photo) => ({ photo, role: 'model', view: 'front' });

describe('preflight', () => {
  it('asks for a garment when a fresh try-on has none', () => {
    const r = preflight({ usePrevious: false, usePhotos: [1], styling: {} }, [model(1)]);
    expect(r.ok).toBe(false);
    expect(r.question).toMatch(/garment/i);
  });

  it('does not ask for a garment when editing the previous result', () => {
    expect(preflight({ usePrevious: true, usePhotos: [], styling: {} }, []).ok).toBe(true);
  });

  it('asks for the second person when a model swap has only one model photo', () => {
    const r = preflight({ usePrevious: false, usePhotos: [1, 2], styling: { model: 'change' } }, [model(1), garment(2)]);
    expect(r.ok).toBe(false);
    expect(r.question).toMatch(/person/i);
  });

  it('allows a model swap when two model photos exist', () => {
    expect(preflight({ usePrevious: false, usePhotos: [1, 2, 3], styling: { model: 'change' } }, [model(1), model(2), garment(3)]).ok).toBe(true);
  });

  it('asks which photo is which when an image has no role', () => {
    const r = preflight({ usePrevious: false, usePhotos: [1, 2], styling: {} }, [garment(1)]);
    expect(r.ok).toBe(false);
    expect(r.question).toMatch(/photo 2/);
  });

  it('a back view with unclear back details still generates, with the back-fabric notice', () => {
    const r = preflight({ usePrevious: false, usePhotos: [1], outputView: 'back', styling: {} }, [garment(1, { unclear: 'back not visible' })]);
    expect(r.ok).toBe(true);
    expect(r.notice).toMatch(/match the back to the fabric/);
  });

  it('a back view with no unclear details gives no notice', () => {
    const r = preflight({ usePrevious: false, usePhotos: [1], outputView: 'back', styling: {} }, [garment(1)]);
    expect(r).toEqual({ ok: true });
  });

  it('a complete plan passes with no question', () => {
    expect(preflight({ usePrevious: false, usePhotos: [1, 2], styling: {} }, [model(1), garment(2)])).toEqual({ ok: true });
  });
});
