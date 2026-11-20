import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { checkFile, checkUrl, pickImageFile, MAX_FILE_BYTES } from '@/lib/imageIntake.js';
import GarmentSlot from '@/components/common/GarmentSlot.jsx';
import { findWorkflow, missingFields, defaultValues } from '@/workflows/engines.js';

const file = (name, type, size = 10) => ({ name, type, size });
const photo = (n) => ({ src: `data:image/jpeg;base64,${n}`, kind: 'file', name: `${n}.jpg` });

describe('checkFile', () => {
  it('accepts jpeg, png and webp', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(checkFile(file('a', t))).toBeNull();
  });
  it('explains HEIC, SVG, non-images, empty and oversized files', () => {
    expect(checkFile(file('p.heic', 'image/heic'))).toMatch(/HEIC/);
    expect(checkFile(file('p.HEIC', ''))).toMatch(/HEIC/);
    expect(checkFile(file('l.svg', 'image/svg+xml'))).toMatch(/vector/);
    expect(checkFile(file('d.pdf', 'application/pdf'))).toMatch(/not an image/);
    expect(checkFile(file('e.jpg', 'image/jpeg', 0))).toMatch(/empty/);
    expect(checkFile(file('big.jpg', 'image/jpeg', MAX_FILE_BYTES + 1))).toMatch(/limit/);
  });
});

describe('checkUrl', () => {
  it('rejects empty, data and non-http links', () => {
    expect(checkUrl('  ')).toBeTruthy();
    expect(checkUrl('data:image/png;base64,AAAA')).toBeTruthy();
    expect(checkUrl('ftp://x.com/a.jpg')).toBeTruthy();
    expect(checkUrl('not a url')).toBeTruthy();
  });
  it('accepts http(s) links', () => expect(checkUrl(' https://x.com/a.jpg ')).toBeNull());
});

describe('pickImageFile', () => {
  it('uses the first image and counts ignored extras and non-images', () => {
    const r = pickImageFile([file('a.pdf', 'application/pdf'), file('b.jpg', 'image/jpeg'), file('c.png', 'image/png')]);
    expect(r.file.name).toBe('b.jpg');
    expect(r.extra).toBe(1);
    expect(r.nonImages).toBe(1);
  });
  it('returns no file for an empty list', () => expect(pickImageFile([]).file).toBeNull());
});

describe('GarmentSlot', () => {
  const base = { label: 'Top', onFront: vi.fn(), onBack: vi.fn(), onError: vi.fn() };

  it('shows front and back slots', () => {
    render(<GarmentSlot {...base} front={null} back={null} />);
    expect(screen.getByRole('button', { name: 'Upload Front' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload Back' })).toBeInTheDocument();
  });

  it('warns when only the back photo is present', () => {
    render(<GarmentSlot {...base} front={null} back={photo('b')} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/front photo/i);
  });

  it('swaps front and back', async () => {
    const onFront = vi.fn();
    const onBack = vi.fn();
    const f = photo('f');
    const b = photo('b');
    render(<GarmentSlot {...base} onFront={onFront} onBack={onBack} front={f} back={b} />);
    await userEvent.click(screen.getByRole('button', { name: /swap front and back/i }));
    expect(onFront).toHaveBeenCalledWith(b);
    expect(onBack).toHaveBeenCalledWith(f);
  });
});

describe('Outfit Studio front/back rules', () => {
  const wf = findWorkflow('outfit-studio');
  const vals = (o) => ({ ...defaultValues(wf), ...o });

  it('needs at least one outfit piece', () => {
    expect(missingFields(wf, vals({}))).not.toEqual([]);
    expect(missingFields(wf, vals({ top: photo('t') }))).toEqual([]);
  });

  it('blocks a back photo without its front', () => {
    expect(missingFields(wf, vals({ shoes: photo('s'), topBack: photo('tb') }))).toContain('front photo of the top');
  });

  it('allows front and back together', () => {
    expect(missingFields(wf, vals({ top: photo('t'), topBack: photo('tb') }))).toEqual([]);
  });

  it('blocks more than 6 photos in total', () => {
    const many = vals({
      model: photo('m'), top: photo('t'), topBack: photo('tb'), bottom: photo('b'), bottomBack: photo('bb'), shoes: photo('s'), accessory: photo('a'),
    });
    expect(missingFields(wf, many).join(' ')).toMatch(/7 of 6/);
  });
});
