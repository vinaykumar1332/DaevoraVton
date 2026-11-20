// Chat state as a pure reducer: easy to test, and the provider only wires it to React, storage and APIs.
//
// Chat    = { id, owner, title, createdAt, updatedAt, messages, photos, lastResult }
// Message = { id, role: 'user' | 'bot' | 'result', text, images?, kind?, prompt?, used?, seconds? }
// run     = null | { chatId, status, creating, photo, startedAt }   (one job at a time)

export const WELCOME = "Hi! Upload a model photo, a garment, shoes or a background, or just tell me what you'd like. I can also upscale an image or remove its background.";
const NEW_TITLE = 'New chat';

export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function newChat(owner, now = Date.now()) {
  return {
    id: uid(),
    owner,
    title: NEW_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [{ id: 'welcome', role: 'bot', text: WELCOME }],
    photos: [],
    lastResult: null,
  };
}

export const initialState = { loaded: false, order: [], chats: {}, activeId: null, run: null };

const titleFrom = (text) => {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
};

function touch(state, chatId, change, now = Date.now()) {
  const chat = state.chats[chatId];
  if (!chat) return state;
  const next = { ...chat, ...change(chat), updatedAt: now };
  return { ...state, chats: { ...state.chats, [chatId]: next }, order: [chatId, ...state.order.filter((id) => id !== chatId)] };
}

export function chatReducer(state, action) {
  switch (action.type) {
    case 'LOADED': {
      const list = action.chats.length ? action.chats : [action.fresh];
      return {
        ...state,
        loaded: true,
        chats: Object.fromEntries(list.map((c) => [c.id, c])),
        order: list.map((c) => c.id),
        activeId: list[0].id,
      };
    }

    case 'NEW_CHAT':
      return {
        ...state,
        chats: { ...state.chats, [action.chat.id]: action.chat },
        order: [action.chat.id, ...state.order],
        activeId: action.chat.id,
      };

    case 'SELECT':
      return state.chats[action.id] ? { ...state, activeId: action.id } : state;

    case 'DELETE': {
      if (!state.chats[action.id]) return state;
      const chats = { ...state.chats };
      delete chats[action.id];
      let order = state.order.filter((id) => id !== action.id);
      if (!order.length) {
        chats[action.fresh.id] = action.fresh;
        order = [action.fresh.id];
      }
      const activeId = state.activeId === action.id ? order[0] : state.activeId;
      return { ...state, chats, order, activeId };
    }

    case 'APPEND':
      return touch(state, action.chatId, (c) => ({
        messages: [...c.messages, action.message],
        title: c.title === NEW_TITLE && action.message.role === 'user' && action.message.text ? titleFrom(action.message.text) : c.title,
      }));

    case 'ADD_PHOTOS':
      return action.photos.length ? touch(state, action.chatId, (c) => ({ photos: [...c.photos, ...action.photos] })) : state;

    // A user message whose turn did not finish: status 'failed' (with a friendly error) or 'stopped'.
    case 'MARK_FAILED':
      return touch(state, action.chatId, (c) => ({
        messages: c.messages.map((m) => (m.id === action.messageId ? { ...m, status: action.status, error: action.error ?? null } : m)),
      }));

    // Removes a user message, the assistant messages of that turn, and the photos it added
    // (used by Retry / Edit, which then send the message again at the end of the chat).
    case 'REMOVE_TURN':
      return touch(state, action.chatId, (c) => {
        const msg = c.messages.find((m) => m.id === action.messageId);
        const photoIds = new Set(msg?.photoIds ?? []);
        return {
          messages: c.messages.filter((m) => m.id !== action.messageId && m.turnOf !== action.messageId),
          photos: c.photos.filter((p) => !photoIds.has(p.id)),
          // If this message named the chat, let the resent (maybe edited) message name it again.
          title: msg?.text && c.title === titleFrom(msg.text) ? NEW_TITLE : c.title,
        };
      });

    case 'SET_LAST_RESULT':
      return touch(state, action.chatId, () => ({ lastResult: action.lastResult }));

    case 'RUN_START':
      return { ...state, run: { chatId: action.chatId, status: action.status ?? 'Thinking…', creating: !!action.creating, photo: action.photo ?? null, startedAt: action.now ?? Date.now() } };

    case 'RUN_UPDATE':
      return state.run ? { ...state, run: { ...state.run, ...action.patch } } : state;

    case 'RUN_END':
      return { ...state, run: null };

    default:
      return state;
  }
}
