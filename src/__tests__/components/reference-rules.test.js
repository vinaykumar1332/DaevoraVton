import { decideReferences } from '../../../backend/agents/chat.js';

const base = { photoCount: 3, newCount: 1, firstNew: 3, hasPrevious: true };

describe('decideReferences', () => {
  it('adds new shoes to the previous result when the assistant chose it', () => {
    expect(decideReferences({ use_photos: [3], use_previous: true }, base)).toEqual({ usePhotos: [3], usePrevious: true });
  });

  it('a new photo the assistant left out is not sent when it listed other photos', () => {
    expect(decideReferences({ use_photos: [1], use_previous: false }, base).usePhotos).toEqual([1]);
  });

  it('a new photo is sent when the assistant listed no photos and the photo has a role', () => {
    const facts = [{ photo: 3, role: 'garment' }];
    expect(decideReferences({ use_photos: [] }, { ...base, facts }).usePhotos).toEqual([3]);
  });

  it('never uses the previous result without one', () => {
    expect(decideReferences({ use_previous: true }, { ...base, hasPrevious: false }).usePrevious).toBe(false);
  });

  it('a follow-up edit forces the previous result', () => {
    expect(decideReferences({}, { ...base, newCount: 0, forcePrevious: true })).toEqual({ usePhotos: [], usePrevious: true });
  });

  it('ignores photo numbers that do not exist', () => {
    expect(decideReferences({ use_photos: [9, -1, 2] }, { ...base, newCount: 0 }).usePhotos).toEqual([2]);
  });
});
