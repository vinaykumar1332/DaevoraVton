import { buildPrompt, normalizeStyling } from '@/agents/studioPrompt.js';

const person = [{ photo: 1, role: 'model', view: 'front' }];
const shirt = [{ photo: 2, role: 'garment', view: 'front', length: 'upper' }];

describe('styling controls', () => {
  it('limits and cleans object lists', () => {
    const s = normalizeStyling({ add: ['a watch\n', '', 5, 'x'.repeat(80)], remove: ['a'.repeat(3), 'b', 'c', 'd', 'e', 'f'] });
    expect(s.add).toEqual(['a watch', 'x'.repeat(40)]);
    expect(s.remove).toHaveLength(5);
  });

  it('pose from a reference photo is matched to that image', () => {
    const notes = [...person, { photo: 3, role: 'pose', view: 'front' }];
    expect(buildPrompt({ prompt: 'P', notes, usePhotos: [1, 3], styling: { pose: 'reference' } })).toMatch(/Match the body pose of image 2/);
  });

  it('a requested pose change keeps the same person', () => {
    expect(buildPrompt({ prompt: 'P', notes: person, usePhotos: [1], styling: { pose: 'change' } })).toMatch(/Change the pose as the user asked/);
  });

  it('model change uses the newest model photo', () => {
    const notes = [...person, { photo: 2, role: 'model', view: 'front' }];
    expect(buildPrompt({ prompt: 'P', notes, usePhotos: [1, 2], styling: { model: 'change' } })).toMatch(/Replace the person with the one from image 2/);
  });

  it('adds and removes the requested objects', () => {
    const out = buildPrompt({ prompt: 'P', notes: person, usePhotos: [1], styling: { add: ['sunglasses'], remove: ['a belt'] } });
    expect(out).toMatch(/Add sunglasses to the look/);
    expect(out).toMatch(/Remove a belt from the image/);
  });

  it('keeps visible accessories and the background of the model photo', () => {
    const out = buildPrompt({ prompt: 'P', notes: person, usePhotos: [1] });
    expect(out).toMatch(/Keep any accessories visible on the person/);
    expect(out).toMatch(/Keep the original background and lighting/);
  });

  it('adds colour and light rules when garments are used', () => {
    expect(buildPrompt({ prompt: 'P', notes: shirt, usePhotos: [2] })).toMatch(/Keep colours true to the photos/);
  });
});
