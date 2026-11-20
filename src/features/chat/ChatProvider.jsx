import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useAuth } from '@/auth/context/AuthContext.jsx';
import { backendChatTurn, backendStartAgentJob, backendAnalyzePhoto } from '@/api/backend.js';
import { findWorkflow } from '@/workflows/engines.js';
import { pollAgent, extractAgentResults, downloadImage } from '@/api/fashn.js';
import { friendlyError, friendlyStatus } from '@/lib/messages.js';
import { notify } from '@/lib/notify.js';
import { listChats, saveChat, deleteChat as removeChat } from '@/lib/chatStore.js';
import { chatReducer, initialState, newChat, uid } from './chatReducer.js'; // chatReducer also used by dispatchNow
import { detectToolIntent, refersBack } from './intent.js';
import { shrinkDataURI } from '@/lib/imageShrink.js';

/*
  AI Studio chat state lives here, above the page routes, so a running job keeps going (and its
  result lands in the right chat) while the user visits other pages. Chats are saved per user.

  Tools: "upscale" and "remove_background" call the app's own Upscale / Remove background modules
  (workflows in engines.js) on one image. They never re-generate the look.
*/

const ChatContext = createContext(null);

const TOOLS = {
  upscale: {
    workflow: 'upscale',
    values: (src, o) => ({ image: { src }, resolution: o.resolution ?? '4k', generation_mode: 'quality' }),
    status: (o) => `Upscaling to ${(o.resolution ?? '4k').toUpperCase()}…`,
    ask: (o) => `Upscale this to ${(o.resolution ?? '4k').toUpperCase()}`,
    done: (o) => `Here it is in ${(o.resolution ?? '4k').toUpperCase()}. Same image, more detail.`,
    file: (o) => `upscaled-${o.resolution ?? '4k'}.png`,
    kind: 'upscale',
  },
  remove_background: {
    workflow: 'background-remove',
    values: (src) => ({ image: { src } }),
    status: () => 'Removing the background…',
    ask: () => 'Remove the background',
    done: () => 'Here is the cut-out with a transparent background.',
    file: () => 'cutout.png',
    kind: 'cutout',
  },
};
const NEED_IMAGE = 'Send me the photo to use, or create a look first, then ask again.';
const RESULT_RESOLUTION = '1k';

/** onJobSettled: called after every chat job (success, failure or stop), e.g. to refresh the credit balance. */
export function ChatProvider({ children, onJobSettled }) {
  const { user } = useAuth();
  const settledRef = useRef(onJobSettled);
  settledRef.current = onJobSettled;
  const spentRef = useRef(false); // true once the current job has started a FASHN (credit-using) call
  const owner = user?.username ?? 'anonymous';
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef(null);
  const saved = useRef(new Map()); // chat id -> last saved chat object

  // Load this user's chats.
  useEffect(() => {
    let alive = true;
    listChats(owner)
      .catch(() => [])
      .then((chats) => {
        if (!alive) return;
        chats.forEach((c) => saved.current.set(c.id, c));
        dispatch({ type: 'LOADED', chats, fresh: newChat(owner) });
      });
    return () => {
      alive = false;
    };
  }, [owner]);

  // Save changed chats (debounced). Chats with only the welcome message are not stored.
  useEffect(() => {
    if (!state.loaded) return;
    const t = setTimeout(() => {
      for (const id of state.order) {
        const chat = state.chats[id];
        if (!chat || saved.current.get(id) === chat || chat.messages.length <= 1) continue;
        saved.current.set(id, chat);
        saveChat(chat).catch(() => notify({ severity: 'warn', summary: 'Chat not saved', detail: 'Browser storage is full or blocked. The chat still works but may not be kept.' }));
      }
    }, 400);
    return () => clearTimeout(t);
  }, [state.chats, state.order, state.loaded]);

  // Stop a running job when the user signs out (the provider unmounts).
  useEffect(() => () => abortRef.current?.abort(), []);

  const say = (chatId, text, extra = {}) => dispatch({ type: 'APPEND', chatId, message: { id: uid(), role: 'bot', text, ...extra } });

  // Applies an action to stateRef at once (and to React state), for code that reads state right after.
  const dispatchNow = (action) => {
    stateRef.current = chatReducer(stateRef.current, action);
    dispatch(action);
  };

  /**
   * Runs fn as the single active job with its own AbortController and error handling.
   * If it fails or is stopped, the user message `messageId` is marked so the UI can offer Retry / Edit.
   */
  const withRun = useCallback(async (chatId, start, fn, messageId) => {
    // abortRef is set synchronously, so a fast double click cannot start two jobs.
    if (abortRef.current) {
      notify({ severity: 'info', summary: 'One moment', detail: 'Another image is still being made. Wait for it or press stop.' });
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: 'RUN_START', chatId, ...start });
    try {
      await fn(ctrl.signal);
    } catch (e) {
      const stopped = ctrl.signal.aborted || e?.name === 'AbortError';
      const f = stopped ? null : friendlyError(e);
      if (messageId) dispatch({ type: 'MARK_FAILED', chatId, messageId, status: stopped ? 'stopped' : 'failed', error: f && `${f.title}. ${f.detail}` });
      else say(chatId, stopped ? 'Stopped. Send a message whenever you are ready.' : `${f.title}. ${f.detail}`);
    } finally {
      abortRef.current = null;
      dispatch({ type: 'RUN_END' });
      // Credits may have been used even if the job failed or was stopped after it was submitted.
      // A plain chat reply uses no FASHN credits, so the balance is only re-read after an image job.
      if (spentRef.current) settledRef.current?.();
      spentRef.current = false;
    }
  }, []);

  /** Calls the Upscale / Remove background module on one image and posts the result. */
  async function executeTool(chatId, tool, src, opts, signal) {
    const t = TOOLS[tool];
    dispatch({ type: 'RUN_UPDATE', patch: { creating: true, photo: src, status: t.status(opts) } });
    const started = Date.now();
    spentRef.current = true;
    const out = await findWorkflow(t.workflow).run(t.values(src, opts), {
      signal,
      onStatus: (status) => dispatch({ type: 'RUN_UPDATE', patch: { status } }),
    });
    const url = out.images?.[0];
    if (!url) throw Object.assign(new Error('No image was returned'), { code: 'NoImageGenerated' });
    dispatch({
      type: 'APPEND',
      chatId,
      message: { id: uid(), role: 'result', kind: t.kind, text: t.done(opts), images: out.images, used: [src], seconds: Math.round((Date.now() - started) / 1000), credits: out.credits ?? null },
    });
    const prev = stateRef.current.chats[chatId]?.lastResult;
    dispatch({ type: 'SET_LAST_RESULT', chatId, lastResult: { url, prompt: prev?.prompt ?? '' } });
    if (opts.download) {
      const ok = await downloadImage(url, t.file(opts));
      if (!ok) notify({ severity: 'info', summary: 'Opened in a new tab', detail: 'Direct download was blocked. Right-click the image and choose Save image.' });
    }
  }

  /** Starts a FASHN look job, polls it, and posts the result. The engine prompt is built on the server. */
  async function runLook(chatId, { enginePrompt, prompt, images, resolution, signal }) {
    const started = Date.now();
    dispatch({ type: 'RUN_UPDATE', patch: { creating: true, photo: images[0] ?? null, status: 'Creating your look…' } });
    spentRef.current = true;
    const { jobId } = await backendStartAgentJob({ prompt: enginePrompt, images: images.slice(0, 6), resolution, generation_mode: 'balanced', signal });
    const final = await pollAgent(jobId, {
      signal,
      onUpdate: (d) => dispatch({ type: 'RUN_UPDATE', patch: { status: friendlyStatus(d.status) } }),
    });
    const ex = extractAgentResults(final);
    if (!ex.images.length) throw Object.assign(new Error('No image was returned'), { code: 'NoImageGenerated' });
    dispatch({
      type: 'APPEND',
      chatId,
      message: {
        id: uid(),
        role: 'result',
        kind: 'look',
        text: 'Here is your look. Want anything changed?',
        images: ex.images,
        prompt,
        engine: enginePrompt,
        resolution,
        used: images,
        seconds: Math.round((Date.now() - started) / 1000),
        credits: ex.creditsUsed ?? null,
      },
    });
    dispatch({ type: 'SET_LAST_RESULT', chatId, lastResult: { url: ex.images[0], prompt, resolution } });
  }

  /** Runs the same look again with the same inputs, prompt and resolution. */
  const regenerate = useCallback(
    (chatId, messageId) => {
      const msg = stateRef.current.chats[chatId]?.messages.find((m) => m.id === messageId);
      if (!msg || msg.kind !== 'look' || !msg.engine || abortRef.current) return;
      return withRun(chatId, { creating: true, photo: msg.used?.[0] ?? null, status: 'Creating your look…' }, (signal) =>
        runLook(chatId, { enginePrompt: msg.engine, prompt: msg.prompt, images: msg.used ?? [], resolution: msg.resolution ?? RESULT_RESOLUTION, signal })
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withRun]
  );

  /** A tool started from a button on a result (no AI call). */
  const runTool = useCallback(
    (chatId, { tool, src, ...opts }) => {
      if (!TOOLS[tool] || !src) return;
      if (abortRef.current) return void notify({ severity: 'info', summary: 'One moment', detail: 'Another image is still being made.' });
      const id = uid();
      dispatch({ type: 'APPEND', chatId, message: { id, role: 'user', text: TOOLS[tool].ask(opts), images: [src], fromTool: true, tool: { tool, src, ...opts } } });
      return withRun(chatId, { creating: true, photo: src, status: TOOLS[tool].status(opts) }, (signal) => executeTool(chatId, tool, src, opts, signal), id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withRun]
  );

  /** A message from the composer. `attached` = [{ id, src }] new photos. `photoMeta` = { [photoId]: analysis }. */
  const send = useCallback(
    (chatId, text, attached = [], photoMeta = {}, editOf = null) => {
      const chat = stateRef.current.chats[chatId];
      const clean = String(text ?? '').trim();
      if (!chat || abortRef.current || (!clean && !attached.length)) return;

      // Earlier turns for the assistant, without failed / stopped turns.
      const unfinished = new Set(chat.messages.filter((m) => m.status).map((m) => m.id));
      const history = chat.messages
        .filter((m) => m.text && !m.fromTool && !m.status && !unfinished.has(m.turnOf))
        .slice(-12)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
      const photos = [...chat.photos, ...attached];
      const lastResult = chat.lastResult;

      const id = uid();
      const reply = (text) => say(chatId, text, { turnOf: id });
      dispatch({ type: 'APPEND', chatId, message: { id, role: 'user', text: clean, images: attached.map((p) => p.src), photoIds: attached.map((p) => p.id) } });
      dispatch({ type: 'ADD_PHOTOS', chatId, photos: attached });

      // 1. Clear tool requests ("upscale to 4k", "remove the background") skip the assistant entirely.
      const intent = clean ? detectToolIntent(clean) : null;
      if (intent) {
        const src = attached[0]?.src ?? lastResult?.url;
        if (!src) return reply(NEED_IMAGE);
        return withRun(chatId, { creating: true, photo: src, status: TOOLS[intent.tool].status(intent) }, (signal) => executeTool(chatId, intent.tool, src, intent, signal), id);
      }

      // 2. Everything else: the assistant decides (reply, generate, or a tool).
      //    New photos without a reference back ("her", "same model", "photo 1", …) start a fresh look:
      //    the assistant then sees ONLY those photos, and not the previous result or its prompt.
      // "Change this look": only the generated image and the change text go to the engine, at its resolution.
      const fresh = !editOf && attached.length > 0 && !refersBack(clean);
      const seen = editOf || fresh ? attached : photos; // what "photo N" means in this turn
      const base = editOf ?? (fresh ? null : lastResult);

      return withRun(chatId, { status: 'Thinking…' }, async (signal) => {
        // Backend: OpenAI reads photos + history, decides the action, builds the full engine prompt.
        // Build a photo meta map for all seen photos: merge session-accumulated meta with this turn's meta.
        const seenMeta = seen.reduce((acc, p) => {
          const m = photoMeta[p.id];
          if (m && Object.keys(m).length) acc[p.id] = m;
          return acc;
        }, {});

        const smallSeen = await Promise.all(seen.map(async (p) => ({ ...p, src: await shrinkDataURI(p.src).catch(() => p.src) })));
        const turn = await backendChatTurn({
          history,
          userText: clean,
          photos: smallSeen,
          newCount: attached.length,
          lastPrompt: base?.prompt,
          hasPrevious: !!base,
          forcePrevious: !!editOf,
          photoMeta: Object.keys(seenMeta).length ? seenMeta : undefined,
          signal,
        });

        if (turn.action === 'upscale' || turn.action === 'remove_background') {
          const src = turn.target_photo ? seen[turn.target_photo - 1]?.src : base?.url;
          if (!src) return reply(NEED_IMAGE);
          reply(turn.reply);
          return executeTool(chatId, turn.action, src, { resolution: turn.resolution, download: /\b(download|save)\b/i.test(clean) }, signal);
        }

        reply(turn.reply);
        if (turn.action !== 'generate') return;

        const images = [];
        if (base && (editOf || turn.use_previous)) images.push(base.url);
        for (const n of turn.use_photos) if (seen[n - 1]) images.push(seen[n - 1].src);

        await runLook(chatId, { enginePrompt: turn.enginePrompt, prompt: turn.prompt, images, resolution: base?.resolution ?? RESULT_RESOLUTION, signal });
      }, id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withRun]
  );

  /**
   * Retry (same text) or Edit (new text) of a failed / stopped message: removes that turn and sends
   * it again at the end of the chat, with the same photos (or the same tool on the same image).
   */
  const resend = useCallback(
    (chatId, messageId, newText) => {
      const msg = stateRef.current.chats[chatId]?.messages.find((m) => m.id === messageId);
      if (!msg || msg.role !== 'user' || abortRef.current) return;
      dispatchNow({ type: 'REMOVE_TURN', chatId, messageId });
      if (msg.tool && newText == null) return runTool(chatId, msg.tool);
      const attached = (msg.images ?? []).map((src) => ({ id: uid(), src }));
      return send(chatId, newText ?? msg.text, msg.tool ? [] : attached);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, runTool]
  );

  const actions = useMemo(
    () => ({
      send,
      runTool,
      resend,
      regenerate,
      stop: () => abortRef.current?.abort(),
      newChat: () => {
        const current = stateRef.current.chats[stateRef.current.activeId];
        // Reuse an empty chat instead of piling up blank ones.
        if (current && current.messages.length <= 1) return;
        dispatch({ type: 'NEW_CHAT', chat: newChat(owner) });
      },
      selectChat: (id) => dispatch({ type: 'SELECT', id }),
      deleteChat: (id) => {
        if (stateRef.current.run?.chatId === id) abortRef.current?.abort();
        saved.current.delete(id);
        removeChat(id).catch(() => {});
        dispatch({ type: 'DELETE', id, fresh: newChat(owner) });
      },
    }),
    [send, runTool, resend, regenerate, owner]
  );

  const value = useMemo(() => ({ state, active: state.chats[state.activeId] ?? null, run: state.run, ...actions }), [state, actions]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
