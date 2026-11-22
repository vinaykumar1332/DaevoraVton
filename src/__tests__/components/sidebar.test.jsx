import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/auth/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { username: 't', name: 'Tester' }, logout: vi.fn() }) }));
vi.mock('@/hooks/useCredits.js', () => ({ useCredits: () => ({ credits: { total: 10 }, loading: false, refresh: vi.fn() }) }));

import App from '@/App.jsx';

const body = () => document.querySelector('.body');
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' });

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/ai-studio');
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
    expect(screen.getByRole('button', { name: /ai studio/i, current: 'page' })).toHaveAttribute('data-tip', 'AI Studio');
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

  it('shows AI Studio as the only page in the sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('button', { name: /remove background/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /outfit studio/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /bulk/i })).toBeNull();
    const aiStudio = screen.getByRole('button', { name: /ai studio/i });
    expect(aiStudio).not.toBeDisabled();
    await user.click(aiStudio);
    expect(window.location.pathname).toBe('/ai-studio');
  });

  it('sends a hidden page URL back to AI Studio', () => {
    window.history.replaceState(null, '', '/background-remove');
    render(<App />);
    expect(window.location.pathname).toBe('/ai-studio');
  });
});
