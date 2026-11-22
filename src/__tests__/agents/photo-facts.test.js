import { mergePhotoFacts, applyRoleOverrides } from '@/agents/photoFacts.js';

describe('mergePhotoFacts', () => {
  it('when the notes and the tags disagree, the notes win', () => {
    const out = mergePhotoFacts({
      tagsByPhoto: { 1: { role: 'garment', view: 'front', length: 'upper' } },
      notes: [{ photo: 1, role: 'garment', view: 'back', length: 'upper' }],
      photoCount: 1,
    });
    expect(out).toEqual([{ photo: 1, role: 'garment', view: 'back', length: 'upper' }]);
  });

  it('fills fields the notes leave out from the tags', () => {
    const out = mergePhotoFacts({
      tagsByPhoto: { 1: { role: 'garment', view: 'front', length: 'full', color: 'navy', fabric: 'silk', logo: true } },
      notes: [{ photo: 1, role: 'garment', view: 'front' }],
      photoCount: 1,
    });
    expect(out[0]).toMatchObject({ role: 'garment', view: 'front', length: 'full', colors: 'navy', fabric: 'silk', logo: true });
  });

  it('uses the tags alone when there are no notes for that photo', () => {
    const out = mergePhotoFacts({ tagsByPhoto: { 2: { role: 'model', view: 'front', framing: 'partial' } }, notes: [], photoCount: 2 });
    expect(out).toEqual([{ photo: 2, role: 'model', view: 'front', framing: 'partial' }]);
  });

  it('uses the notes alone when there are no tags', () => {
    const out = mergePhotoFacts({ tagsByPhoto: {}, notes: [{ photo: 1, role: 'model', view: 'front', framing: 'full' }], photoCount: 1 });
    expect(out).toEqual([{ photo: 1, role: 'model', view: 'front', framing: 'full' }]);
  });

  it('cleans values to the allowed lists and drops photo numbers out of range', () => {
    const out = mergePhotoFacts({
      tagsByPhoto: { 9: { role: 'garment' } },
      notes: [{ photo: 1, role: 'robot', view: 'upside-down' }],
      photoCount: 2,
    });
    expect(out).toEqual([{ photo: 1, role: 'other', view: 'unknown' }]);
  });

  it('keeps the first note when a photo has two', () => {
    const out = mergePhotoFacts({
      tagsByPhoto: {},
      notes: [
        { photo: 1, role: 'model', view: 'front' },
        { photo: 1, role: 'garment', view: 'back' },
      ],
      photoCount: 1,
    });
    expect(out).toEqual([{ photo: 1, role: 'model', view: 'front' }]);
  });
});


describe('applyRoleOverrides', () => {
  it('a role the user set wins over the notes', () => {
    const out = applyRoleOverrides([{ photo: 1, role: 'garment', view: 'front' }], { 1: 'model' });
    expect(out).toEqual([{ photo: 1, role: 'model', view: 'front' }]);
  });

  it('adds a photo that only the user classified', () => {
    expect(applyRoleOverrides([], { 2: 'shoes' })).toEqual([{ photo: 2, role: 'shoes' }]);
  });

  it('ignores roles that are not allowed', () => {
    expect(applyRoleOverrides([{ photo: 1, role: 'garment' }], { 1: 'robot' })).toEqual([{ photo: 1, role: 'garment' }]);
  });
});
