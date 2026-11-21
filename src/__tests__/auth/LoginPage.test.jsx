import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/auth/context/AuthContext.jsx';
import AuthGate from '@/auth/components/AuthGate.jsx';

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Fake server: one valid account, and an optional existing session. */
function mockServer({ session = null, login } = {}) {
  const server = (global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/session') return session ? json(200, { user: session }) : json(401, { error: 'NoSession' });
    if (url === '/api/login') {
      if (login) return login(JSON.parse(init.body));
      const { username, password } = JSON.parse(init.body);
      return username === 'admin' && password === 'right'
        ? json(200, { user: { username: 'admin', role: 'admin', name: 'Admin' } })
        : json(401, { error: 'InvalidCredentials', message: 'Incorrect username or password.' });
    }
    if (url === '/api/logout') return json(200, { ok: true });
    if (url === '/api/render/v1/credits') return json(401, { error: { name: 'SessionExpired' } }, { 'X-Session-Expired': '1' });
    return json(404, {});
  }));
  return server;
}

function setup() {
  window.history.replaceState(null, '', '/ai-studio');
  render(
    <AuthProvider>
      <AuthGate>
        <div>Protected app</div>
      </AuthGate>
    </AuthProvider>
  );
  return userEvent.setup();
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('login flow', () => {
  it('shows the login page when there is no session', async () => {
    mockServer();
    setup();
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByText('Protected app')).not.toBeInTheDocument();
  });

  it('restores an existing session without asking to sign in again', async () => {
    mockServer({ session: { username: 'admin', role: 'admin', name: 'Admin' } });
    setup();
    expect(await screen.findByText('Protected app')).toBeInTheDocument();
  });

  it('keeps the button disabled until both fields are filled', async () => {
    mockServer();
    const user = setup();
    const btn = await screen.findByRole('button', { name: /sign in/i });
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText(/username/i), 'admin');
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText(/^password/i), 'x');
    expect(btn).toBeEnabled();
  });

  it('rejects wrong credentials with an error message', async () => {
    mockServer();
    const user = setup();
    await user.type(await screen.findByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/^password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
    expect(screen.queryByText('Protected app')).not.toBeInTheDocument();
  });

  it('signs in with the correct credentials', async () => {
    const server = mockServer();
    const user = setup();
    await user.type(await screen.findByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/^password/i), 'right');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Protected app')).toBeInTheDocument();
    // the credentials went to the server, and nothing is kept in browser storage
    expect(server).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST' }));
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('shows the server message when sign-in is rate limited or not configured', async () => {
    mockServer({ login: () => json(429, { error: 'TooManyAttempts', message: 'Too many attempts. Try again in 15 minute(s).' }) });
    const user = setup();
    await user.type(await screen.findByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/^password/i), 'x');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('shows a network error message when the server is unreachable', async () => {
    mockServer({
      login: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = setup();
    await user.type(await screen.findByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/^password/i), 'x');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach/i);
  });

  it('returns to the login page when an API call reports the session ended', async () => {
    mockServer({ session: { username: 'admin', role: 'admin', name: 'Admin' } });
    setup();
    await screen.findByText('Protected app');
    await act(async () => {
      await window.fetch('/api/render/v1/credits'); // goes through AuthProvider's wrapper
    });
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/session ended/i);
  });

  it('toggles password visibility', async () => {
    mockServer();
    const user = setup();
    const pwd = await screen.findByLabelText(/^password/i);
    expect(pwd).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(pwd).toHaveAttribute('type', 'text');
  });
});
