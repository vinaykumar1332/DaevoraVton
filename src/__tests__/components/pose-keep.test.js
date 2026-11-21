import { buildPrompt } from '@/agents/studioPrompt.js';

const person = [{ photo: 1, role: 'model', view: 'front' }];
const dress = [{ photo: 2, role: 'garment', view: 'front', length: 'full' }];

describe('pose stays as in the model photo', () => {
  it('keeps the model pose when the pose was not asked to change', () => {
    const out = buildPrompt({ prompt: 'P', notes: [...person, ...dress], usePhotos: [1, 2], styling: { pose: null } });
    expect(out).toMatch(/Keep the pose of the person exactly as in the model photo/);
    expect(out).not.toMatch(/Change the pose as the user asked/);
  });

  it('only changes the pose when the user asked for it', () => {
    const out = buildPrompt({ prompt: 'P', notes: [...person, ...dress], usePhotos: [1, 2], styling: { pose: 'change' } });
    expect(out).toMatch(/Change the pose as the user asked/);
    expect(out).not.toMatch(/Keep the pose of the person/);
  });
});
