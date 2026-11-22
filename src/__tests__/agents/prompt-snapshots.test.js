import { buildPrompt } from '@/agents/studioPrompt.js';

const model = (photo, framing = 'full') => ({ photo, role: 'model', view: 'front', framing });
const garment = (photo, extra = {}) => ({ photo, role: 'garment', view: 'front', ...extra });

describe('engine prompt snapshots', () => {
  it('saree on a model', () => {
    expect(buildPrompt({ prompt: 'The model wears the saree.', notes: [model(1), garment(2, { length: 'full' })], usePhotos: [1, 2] })).toMatchSnapshot();
  });

  it('shirt and jeans, untucked', () => {
    expect(
      buildPrompt({
        prompt: 'Dress the model in the shirt and jeans.',
        notes: [model(1, 'partial'), garment(2, { length: 'upper' }), garment(3, { length: 'lower' })],
        usePhotos: [1, 2, 3],
      })
    ).toMatchSnapshot();
  });

  it('back view', () => {
    expect(buildPrompt({ prompt: 'Show the back.', notes: [model(1), garment(2, { length: 'full' })], usePhotos: [1, 2], outputView: 'back' })).toMatchSnapshot();
  });

  it('model swap', () => {
    expect(
      buildPrompt({ prompt: 'Put the second person in the dress.', notes: [model(1), model(2), garment(3, { length: 'full' })], usePhotos: [1, 2, 3], styling: { model: 'change' } })
    ).toMatchSnapshot();
  });

  it('no model photo', () => {
    expect(buildPrompt({ prompt: 'A dress on a model.', notes: [garment(1, { length: 'full' })], usePhotos: [1] })).toMatchSnapshot();
  });
});
