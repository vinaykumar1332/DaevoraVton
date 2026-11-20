import { createContext, useContext, useState, useCallback } from 'react';

// Hardcoded credentials — replace with an env-based check if needed.
const USERS = [
  { username: 'admin', password: 'fashn2024', role: 'admin', name: 'Admin' },
  { username: 'demo', password: 'demo123', role: 'viewer', name: 'Demo User' },
];

const SESSION_KEY = 'vton_session';

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadSession);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError('');
    // Simulate a small network delay so the loading state is visible.
    await new Promise((r) => setTimeout(r, 600));
    const match = USERS.find((u) => u.username === username.trim() && u.password === password);
    if (match) {
      const session = { username: match.username, role: match.role, name: match.name };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setUser(session);
      setLoading(false);
      return true;
    }
    setError('Incorrect username or password.');
    setLoading(false);
    return false;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setUser(null);
    setError('');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, error, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
