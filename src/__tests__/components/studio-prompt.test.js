import { buildPrompt, normalizeNotes, normalizeView, HOUSE_RULES } from '@/agents/studioPrompt.js';

const P = 'The model in image 1 wears the saree from image 2.';

describe('buildPrompt', () => {
  it('always adds the house rules after the assistant prompt', () => {
    const out = buildPrompt({ prompt: P });
    expect(out.startsWith(P)).toBe(true);
    expect(out).toContain(HOUSE_RULES);
  });

  it('back-facing pose + front-only garment: keep the pose and infer the back, without copying front details', () => {
    const out = buildPrompt({
      prompt: P,
      notes: [
        { photo: 1, role: 'model', view: 'back' },
        { photo: 2, role: 'garment', view: 'front' },
      ],
      usePhotos: [1, 2],
      outputView: 'back',
    });
    expect(out).toMatch(/pose shows the back of the person/i);
    expect(out).toMatch(/garment photos \(image 2\) show only the front/i);
    expect(out).toMatch(/do not copy front-only details/i);
    expect(out).toMatch(/final framing: back view/i);
  });

  it('numbers images the way the engine receives them (previous result first, then use_photos order)', () => {
    const out = buildPrompt({
      prompt: P,
      notes: [
        { photo: 5, role: 'garment', view: 'front' },
        { photo: 3, role: 'model', view: 'side' },
      ],
      usePhotos: [3, 5],
      usePrevious: true,
      outputView: 'side',
    });
    expect(out).toMatch(/\(image 3\) show only the front/); // photo 5 is 2nd in use_photos, after the previous result
    expect(out).toMatch(/side view/);
  });

  it('front + back photos of one garment: the back photo is used for back details only', () => {
    const out = buildPrompt({
      prompt: P,
      notes: [
        { photo: 1, role: 'model', view: 'front' },
        { photo: 2, role: 'garment', view: 'front' },
        { photo: 3, role: 'garment', view: 'back' },
      ],
      usePhotos: [1, 2, 3],
      outputView: 'front',
    });
    expect(out).toMatch(/image 3 shows the back of the garment in image 2/);
    expect(out).not.toMatch(/show only the front/);
  });

  it('front-facing result with only a back photo of the garment: infer the front', () => {
    const out = buildPrompt({ prompt: P, notes: [{ photo: 1, role: 'garment', view: 'back' }], usePhotos: [1], outputView: 'front' });
    expect(out).toMatch(/show only the back, but the final image is front-facing/);
  });

  it('front pose + front garment: no view rules, only the house rules', () => {
    const out = buildPrompt({
      prompt: P,
      notes: [
        { photo: 1, role: 'model', view: 'front' },
        { photo: 2, role: 'garment', view: 'front' },
      ],
      usePhotos: [1, 2],
      outputView: 'front',
    });
    expect(out).toBe(`${P}\n\n${HOUSE_RULES}`);
  });

  it('ignores notes about photos that are not sent to the engine', () => {
    const out = buildPrompt({ prompt: P, notes: [{ photo: 9, role: 'garment', view: 'front' }], usePhotos: [1], outputView: 'back' });
    expect(out).not.toMatch(/show only the front/);
  });
});

describe('buildPrompt: any mix of inputs', () => {
  const rulesFor = (notes, extra = {}) =>
    buildPrompt({ prompt: P, notes, usePhotos: notes.map((n) => n.photo), outputView: 'front', ...extra });

  it('no model photo: create a model that suits the garment (but not when the previous result is the base)', () => {
    expect(rulesFor([{ photo: 1, role: 'garment', view: 'front' }])).toMatch(/no model photo was given/i);
    expect(rulesFor([{ photo: 1, role: 'garment', view: 'front' }], { usePrevious: true })).not.toMatch(/no model photo/i);
  });

  it('garment shown on another person: copy only the garment', () => {
    const out = rulesFor([
      { photo: 1, role: 'model', view: 'front' },
      { photo: 2, role: 'garment', view: 'front', worn: true },
    ]);
    expect(out).toMatch(/image 2 shows the garment worn by someone else: copy only the garment, never that person/i);
  });

  it('flat-lay garment gets a natural drape', () => {
    expect(rulesFor([{ photo: 1, role: 'model', view: 'front' }, { photo: 2, role: 'garment', view: 'flat-lay' }])).toMatch(/image 2 is a garment laid flat/i);
  });

  it('cropped model + full-length garment: show the whole outfit', () => {
    const out = rulesFor([
      { photo: 1, role: 'model', view: 'front', framing: 'partial' },
      { photo: 2, role: 'garment', view: 'front', length: 'full' },
    ]);
    expect(out).toMatch(/model photo is cropped, but the garment is full length/i);
    expect(rulesFor([{ photo: 1, role: 'model', view: 'front', framing: 'partial' }, { photo: 2, role: 'garment', view: 'front', length: 'upper' }])).not.toMatch(/cropped/);
  });

  it('background, shoes and accessory photos each get their own instruction with the right image numbers', () => {
    const out = rulesFor([
      { photo: 1, role: 'model', view: 'front' },
      { photo: 2, role: 'garment', view: 'front' },
      { photo: 3, role: 'shoes', view: 'side' },
      { photo: 4, role: 'accessory', view: 'front' },
      { photo: 5, role: 'background', view: 'unknown' },
    ]);
    expect(out).toMatch(/setting from image 5/);
    expect(out).toMatch(/shoes from image 3/);
    expect(out).toMatch(/accessory from image 4/);
  });

  it('only shoes on the previous result: no "create a model" rule, just the shoe swap', () => {
    const out = buildPrompt({ prompt: P, notes: [{ photo: 1, role: 'shoes', view: 'side' }], usePhotos: [1], usePrevious: true, outputView: 'front' });
    expect(out).toMatch(/shoes from image 2/); // previous result is image 1
    expect(out).not.toMatch(/no model photo/i);
  });
});

describe('normalizeNotes / normalizeView', () => {
  it('keeps optional details only where they belong', () => {
    expect(
      normalizeNotes(
        [
          { photo: 1, role: 'garment', view: 'front', worn: true, length: 'full', framing: 'full' },
          { photo: 2, role: 'model', view: 'back', framing: 'partial', worn: true, length: 'upper' },
          { photo: 3, role: 'garment', view: 'front', worn: 'yes', length: 'huge' },
        ],
        3
      )
    ).toEqual([
      { photo: 1, role: 'garment', view: 'front', worn: true, length: 'full' },
      { photo: 2, role: 'model', view: 'back', framing: 'partial' },
      { photo: 3, role: 'garment', view: 'front' },
    ]);
  });

  it('keeps valid notes, fixes unknown roles and views, drops bad and duplicate photo numbers', () => {
    expect(
      normalizeNotes(
        [
          { photo: 1, role: 'model', view: 'back' },
          { photo: 1, role: 'garment', view: 'front' }, // duplicate
          { photo: 2, role: 'robot', view: 'upside-down' },
          { photo: 7, role: 'garment', view: 'front' }, // out of range
          { photo: 'x' },
          null,
        ],
        3
      )
    ).toEqual([
      { photo: 1, role: 'model', view: 'back' },
      { photo: 2, role: 'other', view: 'unknown' },
    ]);
    expect(normalizeNotes('nope', 3)).toEqual([]);
  });
  it('defaults the output view to front', () => {
    expect(normalizeView('back')).toBe('back');
    expect(normalizeView('upside-down')).toBe('front');
    expect(normalizeView(undefined)).toBe('front');
  });
});
