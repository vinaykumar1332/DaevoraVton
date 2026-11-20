import { renderHook } from '@testing-library/react';
import { useAuth } from '@/auth/context/AuthContext.jsx';

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});
