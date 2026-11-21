import { act, render, waitFor } from '@testing-library/react';
import { ChatProvider, useChat } from '@/features/chat/ChatProvider.jsx';
import { __resetMemoryStore } from '@/lib/chatStore.js';

// --- mocks: no network, record what each module was asked to do ---
const upscaleRun = vi.fn();
const cutoutRun = vi.fn();
vi.mock('@/workflows/engines.js', () => ({
  findWorkflow: (id) => ({ upscale: { run: upscaleRun }, 'background-remove': { run: cutoutRun } })[id],
}));
vi.mock('@/api/backend.js', () => ({
  backendChatTurn: vi.fn(),
  backendStartAgentJob: vi.fn(),
  backendEnhanceRequest: vi.fn(),
  backendScoreLook: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/api/fashn.js', () => ({
  downloadImage: vi.fn(async () => true),
  pollAgent: vi.fn(),
  extractAgentResults: vi.fn(),
}));
vi.mock('@/auth/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { username: 'tester' } }) }));
vi.mock('@/lib/notify.js', () => ({ notify: vi.fn() }));

import { backendChatTurn, backendStartAgentJob } from '@/api/backend.js';
import { downloadImage, pollAgent, extractAgentResults } from '@/api/fashn.js';

let api;
function Probe() {
  api = useChat();
  return null;
}
async function mount() {
  render(
    <ChatProvider>
      <Probe />
    </ChatProvider>
  );
  await waitFor(() => expect(api.state.loaded).toBe(true));
}
const chat = () => api.active;
const last = () => chat().messages.at(-1);

const LOOK_RESULT = { images: ['https://cdn/look.png'], creditsUsed: 2, tools: [] };

beforeEach(() => {
  __resetMemoryStore();
  vi.clearAllMocks();
  upscaleRun.mockResolvedValue({ images: ['https://cdn/up.png'], credits: 4 });
  cutoutRun.mockResolvedValue({ images: ['https://cdn/cut.png'], credits: 1 });
  backendStartAgentJob.mockResolvedValue({ jobId: 'mock-job-123' });
  pollAgent.mockResolvedValue({ status: 'completed', predictions: [] });
  extractAgentResults.mockReturnValue(LOOK_RESULT);
});

const BASE_TURN = { reply: 'Creating it now.', action: 'generate', generate: true, prompt: 'P', enginePrompt: 'P\n\nStudio rules: test', use_photos: [], use_previous: false, resolution: '4k', target_photo: null, photo_notes: [], output_view: 'front' };

/** Generate a first look through the assistant so there is a "previous result". */
async function makeLook() {
  backendChatTurn.mockResolvedValueOnce(BASE_TURN);
  await act(() => api.send(chat().id, 'a model in a red dress'));
  expect(last().kind).toBe('look');
}

describe('AI Studio chat', () => {
  it('"upscale to 4k" calls only the Upscale module on the last result (no assistant call, no re-generation)', async () => {
    await mount();
    await makeLook();
    vi.clearAllMocks();
    upscaleRun.mockResolvedValue({ images: ['https://cdn/up.png'], credits: 4 });

    await act(() => api.send(chat().id, 'upscale to 4k'));

    expect(backendChatTurn).not.toHaveBeenCalled();
    expect(backendStartAgentJob).not.toHaveBeenCalled();
    expect(upscaleRun).toHaveBeenCalledTimes(1);
    expect(upscaleRun.mock.calls[0][0]).toEqual({ image: { src: 'https://cdn/look.png' }, resolution: '4k', generation_mode: 'quality' });
    expect(last()).toMatchObject({ role: 'result', kind: 'upscale', images: ['https://cdn/up.png'], credits: 4 });
    expect(chat().lastResult.url).toBe('https://cdn/up.png'); // later edits continue from the upscaled image
    expect(downloadImage).not.toHaveBeenCalled();
    expect(api.run).toBeNull();
  });

  it('"upscale and download" also downloads the upscaled file', async () => {
    await mount();
    await makeLook();
    await act(() => api.send(chat().id, 'upscale to 2k and download'));
    expect(upscaleRun.mock.calls.at(-1)[0].resolution).toBe('2k');
    expect(downloadImage).toHaveBeenCalledWith('https://cdn/up.png', 'upscaled-2k.png');
  });

  it('upscales an attached photo instead of the previous result', async () => {
    await mount();
    await act(() => api.send(chat().id, 'upscale', [{ id: 'p1', src: 'data:image/jpeg;base64,AAA' }]));
    expect(upscaleRun.mock.calls[0][0].image.src).toBe('data:image/jpeg;base64,AAA');
  });

  it('asks for a photo when there is nothing to upscale', async () => {
    await mount();
    await act(() => api.send(chat().id, 'upscale'));
    expect(upscaleRun).not.toHaveBeenCalled();
    expect(last().role).toBe('bot');
    expect(last().text).toMatch(/send me the photo/i);
  });

  it('follows the assistant when it decides on a tool, with the photo it picked', async () => {
    await mount();
    backendChatTurn.mockResolvedValueOnce({ reply: 'Sure, removing it.', action: 'remove_background', generate: false, prompt: '', use_photos: [], use_previous: false, resolution: '4k', target_photo: 1, enginePrompt: '' });
    await act(() => api.send(chat().id, 'the colours are great, could you get rid of what is behind her?', [{ id: 'p1', src: 'data:x' }]));
    expect(cutoutRun).toHaveBeenCalledWith({ image: { src: 'data:x' } }, expect.anything());
    expect(backendStartAgentJob).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ kind: 'cutout' });
  });

  it('new photos start a fresh look: the old saree look and its prompt are not used for a man in a shirt', async () => {
    await mount();
    // turn 1: saree look from a woman + saree photo
    backendChatTurn.mockResolvedValueOnce({ reply: 'Creating it.', action: 'generate', generate: true, prompt: 'Woman in image 1 wears the saree from image 2', enginePrompt: 'Woman in image 1 wears the saree from image 2', use_photos: [1, 2], use_previous: false, resolution: '4k', target_photo: null, photo_notes: [], output_view: 'front' });
    await act(() => api.send(chat().id, 'dress her in this saree', [{ id: 'w', src: 'data:woman' }, { id: 's', src: 'data:saree' }]));
    expect(chat().lastResult.url).toBe('https://cdn/look.png');

    // turn 2: a man + a shirt, no reference back
    backendChatTurn.mockResolvedValueOnce({ reply: 'Creating it.', action: 'generate', generate: true, prompt: 'Man in image 1 wears the shirt from image 2', enginePrompt: 'Man in image 1 wears the shirt from image 2', use_photos: [1, 2], use_previous: true, resolution: '4k', target_photo: null, photo_notes: [], output_view: 'front' });
    await act(() => api.send(chat().id, 'dress this man in this shirt', [{ id: 'm', src: 'data:man' }, { id: 't', src: 'data:shirt' }]));

    const args = backendChatTurn.mock.calls.at(-1)[0];
    expect(args.photos.map((p) => p.src)).toEqual(['data:man', 'data:shirt']); // only the new photos
    expect(args.hasPrevious).toBe(false);
    expect(args.lastPrompt).toBeUndefined(); // the saree prompt is not shown to the assistant
    expect(backendStartAgentJob.mock.calls.at(-1)[0].images).toEqual(['data:man', 'data:shirt']); // no saree, no old result
  });

  it('adds the house rules and the back-view rule to the prompt sent to the engine', async () => {
    await mount();
    backendChatTurn.mockResolvedValueOnce({
      reply: 'Creating it now.',
      action: 'generate',
      generate: true,
      prompt: 'The woman in image 1 wears the saree from image 2.',
      enginePrompt: 'The woman in image 1 wears the saree from image 2.\n\nshow only the front\n\nStudio rules: test',
      use_photos: [1, 2],
      use_previous: false,
      resolution: '4k',
      target_photo: null,
      photo_notes: [
        { photo: 1, role: 'model', view: 'back' },
        { photo: 2, role: 'garment', view: 'front' },
      ],
      output_view: 'back',
    });
    await act(() => api.send(chat().id, 'dress her in this saree', [{ id: 'w', src: 'data:woman-back' }, { id: 's', src: 'data:saree-front' }]));

    const sent = backendStartAgentJob.mock.calls.at(-1)[0].prompt;
    expect(sent.startsWith('The woman in image 1 wears the saree from image 2.')).toBe(true);
    expect(sent).toMatch(/show only the front/);
    expect(sent).toMatch(/Studio rules:/);
    // the chat keeps the assistant's own prompt as context, without the rules repeated each turn
    expect(chat().lastResult.prompt).toBe('The woman in image 1 wears the saree from image 2.');
  });

  it('refreshes the credit balance after image jobs only (not after a plain chat reply)', async () => {
    const onJobSettled = vi.fn();
    render(
      <ChatProvider onJobSettled={onJobSettled}>
        <Probe />
      </ChatProvider>
    );
    await waitFor(() => expect(api.state.loaded).toBe(true));

    backendChatTurn.mockResolvedValueOnce({ reply: 'Which garment?', action: 'reply', generate: false, prompt: '', enginePrompt: '', use_photos: [], use_previous: false, resolution: '4k', target_photo: null, photo_notes: [], output_view: 'front' });
    await act(() => api.send(chat().id, 'hello'));
    expect(onJobSettled).not.toHaveBeenCalled(); // no FASHN call, no credits used

    await makeLook();
    expect(onJobSettled).toHaveBeenCalledTimes(1);

    upscaleRun.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'InternalServerError' }));
    await act(() => api.send(chat().id, 'upscale'));
    expect(onJobSettled).toHaveBeenCalledTimes(2); // also after a failed job, credits may have been used
  });

  it('a message that refers back keeps the earlier photos and the previous result available', async () => {
    await mount();
    backendChatTurn.mockResolvedValueOnce({ reply: 'ok', action: 'generate', generate: true, prompt: 'P1', enginePrompt: 'P1', use_photos: [1, 2], use_previous: false, resolution: '4k', target_photo: null, photo_notes: [], output_view: 'front' });
    await act(() => api.send(chat().id, 'dress her in this saree', [{ id: 'w', src: 'data:woman' }, { id: 's', src: 'data:saree' }]));

    backendChatTurn.mockResolvedValueOnce({ reply: 'ok', action: 'generate', generate: true, prompt: 'P2', enginePrompt: 'P2', use_photos: [1, 3], use_previous: false, resolution: '4k', target_photo: null, photo_notes: [], output_view: 'front' });
    await act(() => api.send(chat().id, 'now put this shirt on her instead', [{ id: 't', src: 'data:shirt' }]));

    const args = backendChatTurn.mock.calls.at(-1)[0];
    expect(args.photos.map((p) => p.src)).toEqual(['data:woman', 'data:saree', 'data:shirt']);
    expect(args.hasPrevious).toBe(true);
    expect(args.lastPrompt).toBe('P1');
    expect(backendStartAgentJob.mock.calls.at(-1)[0].images).toEqual(['data:woman', 'data:shirt']);
  });

  it('a change to the last look sends that image and its resolution, with no other photos', async () => {
    await mount();
    await makeLook();
    backendChatTurn.mockResolvedValueOnce({ ...BASE_TURN, reply: 'ok', prompt: 'P2', enginePrompt: 'P2', use_previous: true });
    await act(() => api.send(chat().id, 'make the dress red', [], {}, chat().lastResult));

    const args = backendChatTurn.mock.calls.at(-1)[0];
    expect(args).toMatchObject({ forcePrevious: true, hasPrevious: true, lastPrompt: 'P', photos: [] });
    expect(backendStartAgentJob.mock.calls.at(-1)[0]).toMatchObject({ images: ['https://cdn/look.png'], resolution: '1k' });
  });

  it('photos attached after a look are added to that look, not a new one', async () => {
    await mount();
    await makeLook();
    backendChatTurn.mockResolvedValueOnce({ ...BASE_TURN, reply: 'ok', prompt: 'P2', enginePrompt: 'P2', use_photos: [1], use_previous: true });
    await act(() => api.send(chat().id, 'add this belt', [{ id: 'b', src: 'data:belt' }], {}, chat().lastResult));

    const args = backendChatTurn.mock.calls.at(-1)[0];
    expect(args).toMatchObject({ forcePrevious: true, newCount: 1 });
    expect(args.photos.map((p) => p.src)).toEqual(['data:belt']);
    expect(backendStartAgentJob.mock.calls.at(-1)[0].images).toEqual(['https://cdn/look.png', 'data:belt']);
  });

  it('Regenerate runs the same look again with the same inputs, prompt and resolution', async () => {
    await mount();
    backendChatTurn.mockResolvedValueOnce({ ...BASE_TURN, use_photos: [1] });
    await act(() => api.send(chat().id, 'a red dress', [{ id: 'w', src: 'data:w' }]));
    const look = last();
    backendStartAgentJob.mockClear();

    await act(() => api.regenerate(chat().id, look.id));

    expect(backendStartAgentJob).toHaveBeenCalledTimes(1);
    expect(backendStartAgentJob.mock.calls[0][0]).toMatchObject({ prompt: BASE_TURN.enginePrompt, images: ['data:w'], resolution: '1k' });
    expect(last()).toMatchObject({ kind: 'look', prompt: 'P' });
  });

  it('the Upscale button on a result runs the Upscale module on that image', async () => {
    await mount();
    await makeLook();
    await act(() => api.runTool(chat().id, { tool: 'upscale', src: 'https://cdn/look.png', resolution: '4k' }));
    expect(upscaleRun).toHaveBeenCalledTimes(1);
    const msgs = chat().messages;
    expect(msgs.at(-2)).toMatchObject({ role: 'user', text: 'Upscale this to 4K', fromTool: true });
    expect(msgs.at(-1).kind).toBe('upscale');
  });

  it('marks a failed tool request on the user message and frees the run; resend retries the same tool', async () => {
    await mount();
    await makeLook();
    upscaleRun.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'OutOfCredits' }));
    await act(() => api.send(chat().id, 'upscale'));
    expect(last()).toMatchObject({ role: 'user', text: 'upscale', status: 'failed' });
    expect(last().error).toMatch(/not enough credits/i);
    expect(api.run).toBeNull();

    await act(() => api.resend(chat().id, last().id));
    expect(chat().messages.filter((m) => m.status === 'failed')).toHaveLength(0);
    expect(last().kind).toBe('upscale');
  });

  it('keeps chats for the user after a reload (new provider instance)', async () => {
    await mount();
    await makeLook();
    const id = chat().id;
    await new Promise((r) => setTimeout(r, 500)); // debounced save
    api = null;
    await mount();
    expect(api.state.order).toContain(id);
    expect(api.state.chats[id].messages.some((m) => m.kind === 'look')).toBe(true);
    expect(api.state.chats[id].title).toBe('a model in a red dress');
  });

  it('a new chat starts empty and empty chats are reused, not piled up', async () => {
    await mount();
    await makeLook();
    act(() => api.newChat());
    const fresh = chat().id;
    act(() => api.newChat());
    expect(chat().id).toBe(fresh);
    expect(api.state.order).toHaveLength(2);
  });
});
