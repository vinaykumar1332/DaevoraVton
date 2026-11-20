import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import './login.css';

export default function LoginPage() {
  const { login, error, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    await login(username, password);
  }

  return (
    <div className="login-root">
      <aside className="login-visual" aria-hidden="true">
        <div className="login-visual-text">
          <h2>Try any look on, before it exists.</h2>
          <p>Describe an outfit, add your photos, and let the studio style it.</p>
        </div>
      </aside>
      <div className="login-panel">
      <div className="login-card" role="main">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3c1.5 0 2.3 1 2.3 2.2 0 1.1-.8 1.7-1.7 2.2L12 8l8 5c1 .7.9 2.2-.9 2.2H4.9C3.1 15.2 3 13.7 4 13l8-5" />
            </svg>
          </div>
          <div className="login-brand-text">
            <h1>Fitting Room</h1>
            <p>AI Virtual Try-On Studio</p>
          </div>
        </div>

        <h2 className="login-heading">Welcome back</h2>
        <p className="login-sub">Sign in to continue to your studio</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div className="login-field">
            <label className="login-label" htmlFor="login-username">Username</label>
            <div className="login-input-wrap">
              <i className="login-input-icon pi pi-user" aria-hidden="true" />
              <input
                id="login-username"
                type="text"
                className={`login-input${error ? ' error' : ''}`}
                placeholder="Enter your username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {/* Password */}
          <div className="login-field">
            <label className="login-label" htmlFor="login-password">Password</label>
            <div className="login-input-wrap">
              <i className="login-input-icon pi pi-lock" aria-hidden="true" />
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                className={`login-input${error ? ' error' : ''}`}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                <i className={`pi ${showPwd ? 'pi-eye-slash' : 'pi-eye'}`} />
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="login-error" role="alert">
              <i className="pi pi-exclamation-triangle" aria-hidden="true" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button type="submit" className="login-btn" disabled={loading || !username || !password}>
            {loading ? (
              <>
                <span className="login-spinner" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                <i className="pi pi-sign-in" aria-hidden="true" />
                Sign in
              </>
            )}
          </button>
        </form>

        <div className="login-hint">
          Demo: <kbd>admin</kbd> / <kbd>fashn2024</kbd>
        </div>
      </div>
      </div>
    </div>
  );
}
