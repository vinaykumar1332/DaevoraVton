import { proxiedUrl, isHttpUrl } from '@/api/fashn.js';

describe('proxiedUrl', () => {
  it('routes FASHN CDN hosts through the local proxy', () => {
    expect(proxiedUrl('https://cdn.fashn.ai/a/b.png')).toBe('/cdn/a/b.png');
    expect(proxiedUrl('https://media.fashn.ai/x.jpg')).toBe('/media/x.jpg');
  });
  it('leaves other URLs alone', () => {
    expect(proxiedUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://a.com/x.png')).toBe(true);
    expect(isHttpUrl('data:image/png;base64,xx')).toBe(false);
    expect(isHttpUrl('nope')).toBe(false);
  });
});
