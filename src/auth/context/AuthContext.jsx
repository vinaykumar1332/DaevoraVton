import { createContext, useContext, useState, useCallback, useEffect } from 'react';

// Sign-in is checked on the server (api/login.js). The browser only holds an HttpOnly cookie it
// cannot read, so there are no passwords in the JavaScript and nothing to forge in sessionStorage.

const AuthContext = createContext(null);

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false); // false until the first session check finished
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Restore the session after a page load or refresh.
  useEffect(() => {
    let alive = true;
    fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setUser(d?.user ?? null))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // If any API call is refused because the session ended, go back to the login page.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      if (res.status === 401 && res.headers.get('X-Session-Expired')) {
        setUser(null);
        setError('Your session ended. Please sign in again.');
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError('');
    try {
      const { res, data } = await postJson('/api/login', { username: username.trim(), password });
      if (res.ok && data?.user) {
        setUser(data.user);
        return true;
      }
      setError(data?.message || (res.status === 401 ? 'Incorrect username or password.' : 'Sign-in failed. Please try again.'));
      return false;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setError('');
    try {
      await postJson('/api/logout');
    } catch {
      /* the cookie expires on its own */
    }
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, logout, error, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
