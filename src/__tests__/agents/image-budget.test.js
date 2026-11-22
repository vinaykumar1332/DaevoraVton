import { selectImages, MAX_ENGINE_IMAGES } from '@/agents/imageBudget.js';

const role = (photo, r) => ({ photo, role: r });

describe('selectImages', () => {
  it('keeps at most six images, the previous result counting as one', () => {
    const facts = [1, 2, 3, 4, 5, 6, 7].map((p) => role(p, 'garment'));
    const out = selectImages({ previous: true, usePhotos: [1, 2, 3, 4, 5, 6, 7], facts });
    expect(MAX_ENGINE_IMAGES).toBe(6);
    expect(out.usePhotos).toHaveLength(5);
    expect(out.usePrevious).toBe(true);
  });

  it('with seven candidates and no previous result, keeps six', () => {
    const facts = [1, 2, 3, 4, 5, 6, 7].map((p) => role(p, 'garment'));
    expect(selectImages({ usePhotos: [1, 2, 3, 4, 5, 6, 7], facts }).usePhotos).toHaveLength(6);
  });

  it('when over the limit, keeps the model first and drops the lowest-priority role', () => {
    const facts = [role(1, 'background'), role(2, 'model'), role(3, 'accessory'), role(4, 'garment'), role(5, 'shoes'), role(6, 'garment'), role(7, 'other')];
    const out = selectImages({ previous: true, usePhotos: [1, 2, 3, 4, 5, 6, 7], facts });
    expect(out.usePhotos).toEqual([2, 4, 6, 5, 1]);
    expect(out.usePhotos).not.toContain(3);
    expect(out.usePhotos).not.toContain(7);
  });

  it('a previous result plus five photos is exactly six images', () => {
    const facts = [1, 2, 3, 4, 5].map((p) => role(p, 'garment'));
    expect(selectImages({ previous: true, usePhotos: [1, 2, 3, 4, 5], facts }).usePhotos).toHaveLength(5);
  });

  it('a NEW photo the model did not list is not added when the model listed photos', () => {
    const facts = [role(1, 'model'), role(3, 'garment')];
    expect(selectImages({ usePhotos: [1], newPhotos: [3], facts }).usePhotos).toEqual([1]);
  });

  it('a NEW photo with a role is added when the model listed nothing', () => {
    const facts = [role(3, 'garment'), role(4, 'other')];
    expect(selectImages({ usePhotos: [], newPhotos: [3, 4], facts }).usePhotos).toEqual([3]);
  });

  it('removes duplicates and keeps a photo only once', () => {
    expect(selectImages({ usePhotos: [2, 2, 2], facts: [role(2, 'model')] }).usePhotos).toEqual([2]);
  });
});
