import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Workspace from '@/features/workspace/Workspace.jsx';
import { findWorkflow, defaultValues, missingFields } from '@/workflows/engines.js';
import { modeOf, outfitProblems } from '@/workflows/outfitModes.js';

const wf = findWorkflow('outfit-studio');
const photo = (n) => ({ src: `data:image/jpeg;base64,${n}`, kind: 'file', name: `${n}.jpg` });
const vals = (o = {}) => ({ ...defaultValues(wf), ...o });

function setup(over = {}) {
  const setValues = vi.fn();
  const props = {
    wf, values: vals(), setValues, running: false, status: '', elapsed: 0, result: null, lastError: null, history: [],
    missing: [], costLabel: '', runPhoto: null, beforePhoto: null, onGenerate: vi.fn(), onCancel: vi.fn(), onRestore: vi.fn(),
    onError: vi.fn(), toast: { current: null }, ...over,
  };
  render(
      <Workspace {...props} />
  );
  return { setValues, props };
}

describe('Outfit Studio workflows', () => {
  it('defaults to product to model', () => expect(modeOf(vals()).id).toBe('product'));

  it('each workflow needs its own garment photo', () => {
    expect(missingFields(wf, vals({ mode: 'flat' }))).toContain('at least one garment photo');
    expect(missingFields(wf, vals({ mode: 'flat', flatA: photo('f') }))).toEqual([]);
    // a product-mode photo does not count in Indian mode
    expect(missingFields(wf, vals({ mode: 'indian', top: photo('t') }))).toContain('at least one garment photo');
    expect(missingFields(wf, vals({ mode: 'indian', ind: photo('s') }))).toEqual([]);
  });

  it('checks the back-photo and photo-count rules per workflow', () => {
    expect(outfitProblems(vals({ mode: 'indian', indBack: photo('b') }))).toContain('front photo of the main garment');
    const many = vals({ mode: 'flat', model: photo('m'), flatA: photo('a'), flatABack: photo('ab'), flatB: photo('b'), flatBBack: photo('bb'), shoes: photo('s'), accessory: photo('x') });
    expect(outfitProblems(many).join(' ')).toMatch(/7 of 6/);
  });

  it('ignores photos hidden in other workflows when counting', () => {
    const v = vals({ mode: 'flat', flatA: photo('a'), top: photo('t'), topBack: photo('tb'), bottom: photo('b'), bottomBack: photo('bb'), dress: photo('d') });
    expect(outfitProblems(v)).toEqual([]);
  });
});

describe('Workspace layout', () => {
  it('lists the three workflows and switches on click', async () => {
    const { setValues } = setup();
    for (const name of [/product to model/i, /flat lay to model/i, /indian traditional wear/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: /flat lay to model/i }));
    expect(setValues).toHaveBeenCalled();
    const updater = setValues.mock.calls[0][0];
    expect(updater({ mode: 'product' }).mode).toBe('flat');
  });

  it('shows only the slots of the chosen workflow', () => {
    setup({ values: vals({ mode: 'indian' }) });
    expect(screen.getByRole('button', { name: 'Upload Front' })).toBeInTheDocument();
    expect(screen.getByText('Dupatta / stole')).toBeInTheDocument();
    expect(screen.queryByText('Dress / one-piece')).not.toBeInTheDocument();
    expect(screen.getByText('Outfit type')).toBeInTheDocument();
  });

  it('has no Result card until there is something to show', () => {
    const { container } = render(<div />);
    expect(container).toBeTruthy();
    setup();
    expect(screen.queryByLabelText('Result')).not.toBeInTheDocument();
    expect(screen.queryByText(/your result will appear here/i)).not.toBeInTheDocument();
  });

  it('shows the Result card when a run has output', () => {
    setup({ result: { images: ['https://x/y.png'], label: 'Outfit Studio', wfId: 'outfit-studio', credits: 2 }, history: [] });
    expect(screen.getByLabelText('Result')).toBeInTheDocument();
  });
});
