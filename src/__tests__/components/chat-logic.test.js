import { detectToolIntent, refersBack } from '@/features/chat/intent.js';

describe('refersBack', () => {
  it.each(['put this shirt on her', 'same model, new shirt', 'keep the background', 'use photo 1 with this', 'like the previous one', 'make that saree red', 'try it on him', 'do it again'])(
    '"%s" refers back',
    (t) => expect(refersBack(t)).toBe(true)
  );
  it.each(['dress this man in this shirt', 'a man wearing this shirt, studio background', 'put these shoes on the model', 'full body, front view', ''])(
    '"%s" is a fresh request',
    (t) => expect(refersBack(t)).toBe(false)
  );
});
import { chatReducer, initialState, newChat } from '@/features/chat/chatReducer.js';
import { normalizeAction } from '../../../backend/agents/chat.js';

describe('detectToolIntent', () => {
  it.each([
    ['upscale', '4k', false],
    ['Upscale this image to 4K please', '4k', false],
    ['can you upscale it to 2k', '2k', false],
    ['make it HD', '4k', false],
    ['scale it up', '4k', false],
    ['increase the resolution', '4k', false],
    ['sharpen the photo', '4k', false],
    ['upscale and download', '4k', true],
    ['Upscale to 3k then save it', '3k', true],
  ])('"%s" -> upscale %s (download: %s)', (text, resolution, download) => {
    expect(detectToolIntent(text)).toEqual({ tool: 'upscale', resolution, download });
  });

  it.each(['remove the background', 'remove bg', 'make the background transparent', 'cut it out', 'give me a cutout'])('"%s" -> remove background', (text) => {
    expect(detectToolIntent(text)?.tool).toBe('remove_background');
  });

  it.each([
    'make it red and upscale', // other edits -> the assistant decides
    'change the background to a beach',
    'full body, 4k studio photo of a model in this dress',
    'put these shoes on the model',
    'enhance the quality', // vague -> the assistant decides
    'cut out the dress', // names a subject -> the assistant decides (it can still pick remove_background)
    'hello',
    '',
    '   ',
  ])('"%s" -> not a tool-only request', (text) => {
    expect(detectToolIntent(text)).toBeNull();
  });
});

describe('normalizeAction', () => {
  const base = { photoCount: 3, newCount: 0, firstNew: 4, prompt: '' };
  it('keeps known actions and defaults resolution to 4k', () => {
    expect(normalizeAction({ action: 'upscale' }, base)).toEqual({ action: 'upscale', generate: false, target_photo: null, resolution: '4k' });
    expect(normalizeAction({ action: 'upscale', resolution: '2k', target_photo: 2 }, base).target_photo).toBe(2);
  });
  it('falls back safely for unknown or incomplete answers', () => {
    expect(normalizeAction({ action: 'hack' }, base).action).toBe('reply');
    expect(normalizeAction({ generate: true }, base).action).toBe('reply'); // no prompt
    expect(normalizeAction({ generate: true }, { ...base, prompt: 'x' }).action).toBe('generate'); // old format
    expect(normalizeAction({ action: 'upscale', target_photo: 9, resolution: '8k' }, base)).toMatchObject({ target_photo: null, resolution: '4k' });
  });
  it('uses the first new photo when no valid target is given', () => {
    expect(normalizeAction({ action: 'remove_background' }, { photoCount: 3, newCount: 1, firstNew: 3, prompt: '' }).target_photo).toBe(3);
  });
});

describe('chatReducer', () => {
  const load = (chats = []) => chatReducer(initialState, { type: 'LOADED', chats, fresh: newChat('u') });

  it('starts with one fresh chat when nothing is saved', () => {
    const s = load();
    expect(s.loaded).toBe(true);
    expect(s.order).toHaveLength(1);
    expect(s.chats[s.activeId].messages[0].role).toBe('bot');
  });

  it('names a chat after the first user message and moves it to the top', () => {
    let s = load();
    const second = newChat('u');
    s = chatReducer(s, { type: 'NEW_CHAT', chat: second });
    const firstId = s.order[1];
    s = chatReducer(s, { type: 'APPEND', chatId: firstId, message: { id: '1', role: 'user', text: 'Dress the model in a long red gown with gold embroidery please' } });
    expect(s.chats[firstId].title).toBe('Dress the model in a long red gown with…');
    expect(s.order[0]).toBe(firstId);
    s = chatReducer(s, { type: 'APPEND', chatId: firstId, message: { id: '2', role: 'user', text: 'Another' } });
    expect(s.chats[firstId].title).toMatch(/^Dress/); // only the first message names it
  });

  it('deleting the last chat leaves a fresh one; deleting the active chat selects another', () => {
    let s = load();
    const only = s.activeId;
    const fresh = newChat('u');
    s = chatReducer(s, { type: 'DELETE', id: only, fresh });
    expect(s.order).toEqual([fresh.id]);
    expect(s.activeId).toBe(fresh.id);

    const b = newChat('u');
    s = chatReducer(s, { type: 'NEW_CHAT', chat: b });
    s = chatReducer(s, { type: 'DELETE', id: b.id, fresh: newChat('u') });
    expect(s.activeId).toBe(fresh.id);
  });

  it('tracks one run at a time', () => {
    let s = load();
    s = chatReducer(s, { type: 'RUN_START', chatId: s.activeId, status: 'Thinking…', now: 5 });
    s = chatReducer(s, { type: 'RUN_UPDATE', patch: { creating: true } });
    expect(s.run).toMatchObject({ chatId: s.activeId, creating: true, startedAt: 5 });
    expect(chatReducer(s, { type: 'RUN_END' }).run).toBeNull();
    expect(chatReducer({ ...s, run: null }, { type: 'RUN_UPDATE', patch: { creating: true } }).run).toBeNull();
  });
});
