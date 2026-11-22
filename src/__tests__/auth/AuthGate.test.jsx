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

  it.each(['/', '/pricing', '/about', '/ai-studio'])('shows the sign-in page on %s for a signed-out visitor', (path) => {
    at(path);
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('renders the app for a signed-in user', () => {
    auth.user = { username: 'admin' };
    at('/ai-studio');
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('app')).toBeInTheDocument();
  });
});
