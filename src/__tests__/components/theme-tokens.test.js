import fs from 'node:fs';
import path from 'node:path';

// shadcn/ui reads these CSS variables (defined in src/styles/foundation/tailwind.css). Any other stylesheet that
// defines one of them silently re-themes every shadcn component (e.g. --accent turned hovers bright blue).
const SHADCN_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive',
  'border', 'input', 'ring', 'radius',
];

const srcDir = path.resolve(__dirname, '../..');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });

const styleFiles = walk(path.join(srcDir, 'styles')).filter((f) => f.endsWith('.css') && !f.endsWith(path.join('foundation', 'tailwind.css')));
describe('theme tokens', () => {
  it.each(styleFiles)('%s does not redefine shadcn variables', (file) => {
    const css = fs.readFileSync(file, 'utf8');
    const clashes = SHADCN_TOKENS.filter((t) => new RegExp(`--${t}\\s*:`).test(css));
    expect(clashes).toEqual([]);
  });
});
