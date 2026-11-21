import { render, screen } from '@testing-library/react';
import AuthGate from '@/auth/components/AuthGate.jsx';

const auth = { user: null, ready: true, login: vi.fn(), error: null, loading: false };
vi.mock('@/auth/context/AuthContext.jsx', () => ({ useAuth: () => auth }));

const at = (path) => window.history.replaceState(null, '', path);

describe('AuthGate', () => {
  afterEach(() => {
    auth.user = null;
    at('/');
  });

  it('shows the landing page on / for signed-out visitors', async () => {
    at('/');
    render(<AuthGate><p>app</p></AuthGate>);
    expect(await screen.findByRole('heading', { name: /try any look on/i })).toBeInTheDocument();
  });

  it('shows the pricing and about pages to signed-out visitors', async () => {
    at('/pricing/');
    const { unmount } = render(<AuthGate><p>app</p></AuthGate>);
    expect(await screen.findByRole('heading', { name: 'Credits' })).toBeInTheDocument();
    unmount();

    at('/about');
    render(<AuthGate><p>app</p></AuthGate>);
    expect(await screen.findByRole('heading', { name: /about fitting room/i })).toBeInTheDocument();
  });

  it('keeps the sign-in form on every other path', () => {
    at('/ai-studio');
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('renders the app for a signed-in user on any path', () => {
    auth.user = { username: 'admin' };
    at('/');
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('app')).toBeInTheDocument();
  });
});
