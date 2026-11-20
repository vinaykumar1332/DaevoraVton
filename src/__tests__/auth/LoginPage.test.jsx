import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/auth/context/AuthContext.jsx';
import AuthGate from '@/auth/components/AuthGate.jsx';

function setup() {
  render(
    <AuthProvider>
      <AuthGate>
        <div>Protected app</div>
      </AuthGate>
    </AuthProvider>
  );
  return userEvent.setup();
}

describe('login flow', () => {
  it('shows the login page when signed out', () => {
    setup();
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByText('Protected app')).not.toBeInTheDocument();
  });

  it('keeps the button disabled until both fields are filled', async () => {
    const user = setup();
    const btn = screen.getByRole('button', { name: /sign in/i });
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText(/username/i), 'admin');
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText(/^password/i), 'x');
    expect(btn).toBeEnabled();
  });

  it('rejects wrong credentials with an error message', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/^password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
    expect(screen.queryByText('Protected app')).not.toBeInTheDocument();
  });

  it('signs in with the correct credentials and stores the session', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/^password/i), 'fashn2024');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Protected app', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('vton_session')).username).toBe('admin');
  });

  it('toggles password visibility', async () => {
    const user = setup();
    const pwd = screen.getByLabelText(/^password/i);
    expect(pwd).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(pwd).toHaveAttribute('type', 'text');
  });
});
