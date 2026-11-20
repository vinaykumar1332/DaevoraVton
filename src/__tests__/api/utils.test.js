import { cn, clamp, formatCount } from '@/lib/utils.js';

describe('utils', () => {
  it('cn drops falsy values', () => expect(cn('a', false, null, 'b')).toBe('a b'));
  it('clamp bounds a value', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
  it('formatCount compacts thousands', () => {
    expect(formatCount(1200)).toBe('1.2k');
    expect(formatCount(null)).toBe('—');
  });
});
