import fs from 'node:fs';
import path from 'node:path';

// shadcn/ui reads these CSS variables (defined in src/styles/tailwind.css). Any other stylesheet that
// defines one of them silently re-themes every shadcn component (e.g. --accent turned hovers bright blue).
const SHADCN_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive',
  'border', 'input', 'ring', 'radius',
];

const stylesDir = path.resolve(__dirname, '../../styles');
const legacy = fs.readdirSync(stylesDir).filter((f) => f.endsWith('.css') && f !== 'tailwind.css');
const featureCss = ['features/workspace/workspace.css'].map((f) => path.resolve(__dirname, '../..', f));

describe('theme tokens', () => {
  it.each([...legacy.map((f) => path.join(stylesDir, f)), ...featureCss])('%s does not redefine shadcn variables', (file) => {
    const css = fs.readFileSync(file, 'utf8');
    const clashes = SHADCN_TOKENS.filter((t) => new RegExp(`--${t}\\s*:`).test(css));
    expect(clashes).toEqual([]);
  });
});
