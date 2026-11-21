import { buildPrompt, normalizeStyling } from '@/agents/studioPrompt.js';

const shirt = [{ photo: 1, role: 'garment', view: 'front', length: 'upper' }];

describe('styling rules', () => {
  it('keeps a top untucked by default, even if the photo shows it tucked', () => {
    expect(buildPrompt({ prompt: 'P', notes: shirt, usePhotos: [1] })).toMatch(/wear it untucked, hanging over the waistband/);
  });

  it('tucks the top in only when asked', () => {
    const out = buildPrompt({ prompt: 'P', notes: shirt, usePhotos: [1], styling: { tuck: 'in' } });
    expect(out).toMatch(/Tuck the top neatly into the trousers/);
    expect(out).not.toMatch(/untucked/);
  });

  it('adds no tuck rule for a full-length garment', () => {
    const dress = [{ photo: 1, role: 'garment', view: 'front', length: 'full' }];
    expect(buildPrompt({ prompt: 'P', notes: dress, usePhotos: [1] })).not.toMatch(/tuck/i);
  });

  it('rolls sleeves and sets the fit when asked', () => {
    const out = buildPrompt({ prompt: 'P', notes: shirt, usePhotos: [1], styling: { sleeves: 'rolled', fit: 'loose' } });
    expect(out).toMatch(/Roll the sleeves up/);
    expect(out).toMatch(/Relaxed, loose fit/);
  });

  it('keeps a logo on the garment exactly as in its photo', () => {
    const logo = [{ photo: 1, role: 'garment', view: 'front', length: 'upper', logo: true }];
    expect(buildPrompt({ prompt: 'P', notes: logo, usePhotos: [1] })).toMatch(/keep the same design, colours, size and position/);
  });

  it('prints a logo photo the user sent onto the garment', () => {
    const notes = [
      { photo: 1, role: 'garment', view: 'front', length: 'upper' },
      { photo: 2, role: 'logo', view: 'flat-lay' },
    ];
    const out = buildPrompt({ prompt: 'P', notes, usePhotos: [1, 2] });
    expect(out).toMatch(/Print the logo from image 2 onto the garment/);
  });

  it('drops unknown styling values', () => {
    expect(normalizeStyling({ tuck: 'sideways', sleeves: 'rolled', fit: 'huge' })).toMatchObject({ tuck: null, sleeves: 'rolled', fit: null });
  });
});
