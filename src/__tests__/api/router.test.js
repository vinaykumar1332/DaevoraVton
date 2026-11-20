import { renderHook, act } from '@testing-library/react';
import { idFromPath, pathFor, useRoute } from '@/lib/router.js';

const IDS = ['ai-studio', 'outfit-studio', 'bulk'];

describe('idFromPath / pathFor', () => {
  it('maps known paths to ids', () => {
    expect(idFromPath('/outfit-studio', IDS)).toBe('outfit-studio');
    expect(idFromPath('/bulk/', IDS)).toBe('bulk');
  });
  it('returns null for "/" and unknown paths', () => {
    expect(idFromPath('/', IDS)).toBeNull();
    expect(idFromPath('/nope', IDS)).toBeNull();
  });
  it('builds paths with optional params, skipping empty ones', () => {
    expect(pathFor('bulk')).toBe('/bulk');
    expect(pathFor('outfit-studio', { workflow: 'indian', x: '' })).toBe('/outfit-studio?workflow=indian');
  });
});

describe('useRoute', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('redirects "/" to the default page', () => {
    const { result } = renderHook(() => useRoute(IDS));
    expect(result.current.active).toBe('ai-studio');
    expect(window.location.pathname).toBe('/ai-studio');
  });

  it('reads the page and query params from the URL', () => {
    window.history.replaceState(null, '', '/outfit-studio?workflow=flat');
    const { result } = renderHook(() => useRoute(IDS));
    expect(result.current.active).toBe('outfit-studio');
    expect(result.current.params.workflow).toBe('flat');
  });

  it('navigates without a reload and follows back/forward', () => {
    const { result } = renderHook(() => useRoute(IDS));
    act(() => result.current.navigate('bulk'));
    expect(window.location.pathname).toBe('/bulk');
    expect(result.current.active).toBe('bulk');
    act(() => {
      window.history.back();
    });
  });
});
