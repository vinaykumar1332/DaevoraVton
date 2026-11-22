import { buildPrompt, normalizeNotes } from '@/agents/studioPrompt.js';

const model = { photo: 1, role: 'model', view: 'front', framing: 'full' };
const saree = { photo: 2, role: 'garment', view: 'front', length: 'full', colors: 'green and gold' };
const blouseDesign = { photo: 3, role: 'garment', view: 'back', length: 'upper', colors: 'magenta', design_only: true };

describe('design references (for example a blouse inspired by a design)', () => {
  it('keeps the design_only flag on garment notes', () => {
    const out = normalizeNotes([blouseDesign], 3);
    expect(out[0].design_only).toBe(true);
  });

  it('drops the flag on other roles', () => {
    expect(normalizeNotes([{ photo: 1, role: 'model', view: 'front', design_only: true }], 1)[0]).not.toHaveProperty('design_only');
  });

  it('tells the engine to take only the design and not the colour', () => {
    const out = buildPrompt({ prompt: 'P', notes: [model, saree, blouseDesign], usePhotos: [1, 2, 3] });
    expect(out).toMatch(/Use only the design of image 3: its neckline, borders, back cut and sleeve shape\. Do not copy its colour, fabric or print/);
  });

  it('adds no design rule when no reference is design-only', () => {
    const out = buildPrompt({ prompt: 'P', notes: [model, saree], usePhotos: [1, 2] });
    expect(out).not.toMatch(/Use only the design of/);
  });
});
