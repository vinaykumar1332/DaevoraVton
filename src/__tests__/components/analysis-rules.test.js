import { buildPrompt, normalizeNotes } from '@/agents/studioPrompt.js';

describe('richer garment analysis', () => {
  it('keeps the descriptive fields and strips line breaks', () => {
    const [note] = normalizeNotes([{ photo: 1, role: 'garment', view: 'front', pattern: 'small navy florals\non white', details: 'gold zari border' }], 1);
    expect(note).toMatchObject({ pattern: 'small navy florals on white', details: 'gold zari border' });
  });

  it('ignores the descriptive fields on non-garments', () => {
    const [note] = normalizeNotes([{ photo: 1, role: 'shoes', view: 'front', pattern: 'striped' }], 1);
    expect(note.pattern).toBeUndefined();
  });

  it('tells the engine to keep the print and details exactly', () => {
    const notes = normalizeNotes([{ photo: 1, role: 'garment', view: 'front', length: 'upper', pattern: 'navy florals', colors: 'navy and white', details: 'pearl buttons' }], 1);
    const out = buildPrompt({ prompt: 'P', notes, usePhotos: [1] });
    expect(out).toMatch(/Garment in image 1 \(colours: navy and white; print or pattern: navy florals; details to keep: pearl buttons\)/);
  });

  it('says what is not visible instead of inventing it', () => {
    const notes = normalizeNotes([{ photo: 1, role: 'garment', view: 'front', unclear: 'back not visible' }], 1);
    expect(buildPrompt({ prompt: 'P', notes, usePhotos: [1] })).toMatch(/do not invent them: image 1: back not visible\./);
  });
});
