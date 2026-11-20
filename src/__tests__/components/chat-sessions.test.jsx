import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatProvider } from '@/features/chat/ChatProvider.jsx';
import ChatStudio from '@/features/chat/ChatStudio.jsx';
import { __resetMemoryStore } from '@/lib/chatStore.js';

vi.mock('@/workflows/engines.js', () => ({ findWorkflow: () => ({ run: vi.fn() }) }));
vi.mock('@/api/backend.js', () => ({ backendChatTurn: vi.fn(), backendStartAgentJob: vi.fn(), backendEnhanceRequest: vi.fn() }));
vi.mock('@/api/fashn.js', () => ({ downloadImage: vi.fn(async () => true), pollAgent: vi.fn(), extractAgentResults: vi.fn(() => ({ images: [], creditsUsed: 0, tools: [] })) }));
vi.mock('@/auth/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { username: 'ui-tester' } }) }));
vi.mock('@/lib/notify.js', () => ({ notify: vi.fn() }));

import { backendChatTurn } from '@/api/backend.js';

const REPLY = { reply: 'Tell me more.', action: 'reply', generate: false, prompt: '', enginePrompt: '', use_photos: [], use_previous: false, resolution: '4k', target_photo: null, photo_notes: [], output_view: 'front' };

// jsdom gaps used by Radix popovers and the chat log
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollTo ??= function () {};
Element.prototype.scrollIntoView ??= function () {};

async function setup() {
  const user = userEvent.setup();
  render(
    <ChatProvider>
      <ChatStudio />
    </ChatProvider>
  );
  await screen.findByRole('textbox', { name: 'Message' });
  return user;
}
async function say(user, text, expectText = 'Tell me more.') {
  await user.type(screen.getByRole('textbox', { name: 'Message' }), `${text}{Enter}`);
  if (expectText) await screen.findByText(expectText);
}
const heading = (name) => screen.getByRole('heading', { name });

beforeEach(() => {
  __resetMemoryStore();
  backendChatTurn.mockReset();
  backendChatTurn.mockResolvedValue(REPLY);
});

describe('chat header: history and new chat', () => {
  it('has no side column; title, History and New chat are in the header', async () => {
    await setup();
    expect(document.querySelector('.chat-list')).toBeNull();
    const header = document.querySelector('.chat-head');
    expect(within(header).getByRole('heading', { name: 'New chat' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Chat history, 1 chat' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'New chat' })).toBeDisabled(); // nothing to start over from yet
  });

  it('starts a new chat, lists both, searches, and switches back', async () => {
    const user = await setup();
    await say(user, 'red gown for the model');
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(heading('New chat')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Chat history, 2 chats' }));
    const list = await screen.findByRole('list', { name: 'Saved chats' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    await user.type(screen.getByRole('textbox', { name: 'Search chats' }), 'gown');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await user.click(within(list).getByRole('button', { name: /^red gown for the model/i }));

    await waitFor(() => expect(heading('red gown for the model')).toBeInTheDocument());
    expect(screen.queryByRole('list', { name: 'Saved chats' })).toBeNull(); // menu closed after picking
  });

  it('deletes a chat only after confirming', async () => {
    const user = await setup();
    await say(user, 'first look');
    await user.click(screen.getByRole('button', { name: /chat history/i }));
    const list = await screen.findByRole('list', { name: 'Saved chats' });

    await user.click(within(list).getByRole('button', { name: /delete chat first look/i }));
    await user.click(within(list).getByRole('button', { name: 'Keep' }));
    expect(within(list).getByRole('button', { name: /^first look/i })).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: /delete chat first look/i }));
    await user.click(within(list).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(heading('New chat')).toBeInTheDocument());
  });
});

describe('failed messages: retry and edit', () => {
  const fail = () => Object.assign(new Error('x'), { code: 'RateLimitExceeded' });

  it('shows why a message failed, and Retry sends the same text again (once, at the end)', async () => {
    const user = await setup();
    backendChatTurn.mockRejectedValueOnce(fail());
    await say(user, 'blue saree on the model', null);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not completed/i);
    expect(alert).toHaveTextContent(/busy right now/i);

    await user.click(within(alert).getByRole('button', { name: /retry/i }));
    await screen.findByText('Tell me more.');
    expect(backendChatTurn).toHaveBeenCalledTimes(2);
    expect(backendChatTurn.mock.calls[1][0].userText).toBe('blue saree on the model');
    expect(within(screen.getByRole('log')).getAllByText('blue saree on the model')).toHaveLength(1); // the failed copy was replaced
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Edit lets you change the text in place and resend; Escape cancels', async () => {
    const user = await setup();
    backendChatTurn.mockRejectedValueOnce(fail());
    await say(user, 'blue sare', null);
    const alert = await screen.findByRole('alert');

    await user.click(within(alert).getByRole('button', { name: /edit/i }));
    const box = screen.getByRole('textbox', { name: 'Edit your message' });
    expect(box).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Edit your message' })).toBeNull();

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: /edit/i }));
    const again = screen.getByRole('textbox', { name: 'Edit your message' });
    await user.clear(again);
    await user.type(again, 'blue saree, Nivi drape{Enter}');

    await screen.findByText('Tell me more.');
    expect(backendChatTurn.mock.calls.at(-1)[0].userText).toBe('blue saree, Nivi drape');
    expect(screen.queryByText('blue sare')).toBeNull();
    expect(heading('blue saree, Nivi drape')).toBeInTheDocument(); // the chat is renamed after the edited text
  });

  it('a stopped message offers Retry too, and failed turns are left out of the assistant history', async () => {
    const user = await setup();
    backendChatTurn.mockImplementationOnce(
      (args) => new Promise((_, reject) => args.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    );
    await say(user, 'slow one', null);
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText(/stopped before it finished/i)).toBeInTheDocument();

    await say(user, 'next message');
    const history = backendChatTurn.mock.calls.at(-1)[0].history.map((h) => h.content);
    expect(history).not.toContain('slow one');
  });
});

describe('composer', () => {
  it('suggestion tags fill and focus the message box; Send is disabled until there is something to send', async () => {
    const user = await setup();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    const cards = within(screen.getByRole('group', { name: 'Quick start' })).getAllByRole('button');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((t) => expect(t.querySelector('svg')).not.toBeNull()); // every card has an icon

    await user.click(cards[0]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(box).toHaveValue('Dress a model in my garment');
    expect(box).toHaveFocus();
    expect(send).toBeEnabled();
  });

  it('attach and Improve live inside the composer card, without the keyboard hint', async () => {
    await setup();
    const card = document.querySelector('.cbox');
    expect(within(card).getByRole('button', { name: 'Attach photos' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /improve/i })).toBeDisabled(); // nothing to improve yet
    expect(within(card).queryByText(/to send/i)).toBeNull();
  });
});
