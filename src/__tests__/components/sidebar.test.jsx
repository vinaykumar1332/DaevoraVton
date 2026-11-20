import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/auth/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { username: 't', name: 'Tester' }, logout: vi.fn() }) }));
vi.mock('@/hooks/useCredits.js', () => ({ useCredits: () => ({ credits: { total: 10 }, loading: false, refresh: vi.fn() }) }));

import App from '@/App.jsx';

const body = () => document.querySelector('.body');
const nav = () => screen.getByRole('navigation', { name: 'Workflows' });

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/upscale');
});

describe('sidebar', () => {
  it('collapses to an icon rail and expands again, remembering the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    expect(body()).not.toHaveClass('sb-collapsed');
    expect(nav()).toHaveAttribute('data-collapsed', 'false');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar', expanded: true }));
    expect(body()).toHaveClass('sb-collapsed');
    expect(nav()).toHaveAttribute('data-collapsed', 'true');
    // labels stay in the page for screen readers and as hover tips
    expect(screen.getByRole('button', { name: /upscale/i, current: 'page' })).toHaveAttribute('data-tip', 'Upscale');
    expect(JSON.parse(localStorage.getItem('fr.sidebarCollapsed'))).toBe(true);

    unmount();
    render(<App />);
    expect(body()).toHaveClass('sb-collapsed'); // remembered after a reload
  });

  it('toggles with Ctrl+B', () => {
    render(<App />);
    act(() => {
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    });
    expect(body()).toHaveClass('sb-collapsed');
    act(() => {
      fireEvent.keyDown(window, { key: 'B', ctrlKey: true });
    });
    expect(body()).not.toHaveClass('sb-collapsed');
  });

  it('navigates from the sidebar and marks the current page', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /remove background/i }));
    expect(window.location.pathname).toBe('/background-remove');
    expect(screen.getByRole('button', { name: /remove background/i })).toHaveAttribute('aria-current', 'page');
  });
});
