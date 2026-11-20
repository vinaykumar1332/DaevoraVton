import { useEffect, useRef, useState } from 'react';
import Lightbox from '@/components/common/Lightbox.jsx';
import { fileToJpegDataURI, downloadImage } from '@/api/fashn.js';
import { agentJob } from '@/workflows/engines.js';
import { chatTurn, enhanceRequest } from '@/agents/chatAgent.js';
import { friendlyError } from '@/lib/messages.js';
import ResultBubble from '@/features/gallery/ResultCard.jsx';
import FittingLoader from '@/components/common/FittingLoader.jsx';

const MAX_PHOTOS = 8;
const WELCOME_SUGGESTIONS = ['Dress a model in my garment', 'Put these shoes on the model', 'Change the background to a studio'];
const PHOTO_SUGGESTIONS = ['Put these on the model', 'Use this as the background', 'Dress the model in these'];
const RESULT_SUGGESTIONS = ['Make it longer', 'Change the colour', 'Different pose', 'Change the background', 'Make it full body'];
const MORE_SUGGESTIONS = ['Full body, front view', 'Plain grey studio background', 'Make the top and bottom match'];

let seq = 0;
const nid = () => `m${Date.now()}-${seq++}`;

/** Suggestions for the current moment, plus any that match what the user is typing. */
function suggestFor(input, pending, lastResult, onlyWelcome) {
  const base = pending.length ? PHOTO_SUGGESTIONS : lastResult ? RESULT_SUGGESTIONS : onlyWelcome ? WELCOME_SUGGESTIONS : [];
  const words = input.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const typed = words.length ? [...RESULT_SUGGESTIONS, ...WELCOME_SUGGESTIONS, ...MORE_SUGGESTIONS].filter((s) => words.some((w) => s.toLowerCase().includes(w))) : [];
  return [...new Set([...typed, ...base])].slice(0, 5);
}

export default function ChatStudio({ toast }) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'bot',
      text: "Hi! Upload a model photo, a garment, shoes or a background, or just tell me what you'd like. I'll ask if I need anything.",
    },
  ]);
  const [photos, setPhotos] = useState([]); // every photo sent in this chat: {id, src}
  const [pending, setPending] = useState([]); // photos attached to the message being written
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [status, setStatus] = useState('');
  const [lastResult, setLastResult] = useState(null); // {url, prompt}
  const [lightbox, setLightbox] = useState(null); // {images, index}
  const [dragging, setDragging] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [creating, setCreating] = useState(false); // a look is being rendered
  const [loadPhoto, setLoadPhoto] = useState(null); // photo shown behind the fitting animation
  const [atBottom, setAtBottom] = useState(true);

  // Live timer while a look is being made.
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, [busy]);
  const logRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const abortRef = useRef(null);

  // Follow the conversation only while the reader is at the bottom.
  useEffect(() => {
    if (atBottom) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, atBottom]);

  // The text box grows with the text instead of scrolling inside a small box.
  useEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 320)}px`;
  }, [input]);

  const say = (text, extra = {}) => setMessages((m) => [...m, { id: nid(), role: 'bot', text, ...extra }]);

  async function addFiles(fileList) {
    const files = [...(fileList ?? [])].filter((f) => f.type.startsWith('image/'));
    const room = MAX_PHOTOS - pending.length;
    if (!files.length) return;
    if (room <= 0) {
      toast?.current?.show({ severity: 'warn', summary: 'Photos', detail: `You can attach up to ${MAX_PHOTOS} photos per message.`, life: 4000 });
      return;
    }
    try {
      const made = await Promise.all(
        files.slice(0, room).map(async (f) => {
          const r = await fileToJpegDataURI(f);
          return { id: nid(), src: r.dataURI };
        })
      );
      setPending((p) => [...p, ...made]);
    } catch (e) {
      toast?.current?.show({ severity: 'warn', summary: 'Photo', detail: e.message, life: 4000 });
    }
  }

  async function enhance() {
    const t = input.trim();
    if (!t || enhancing || busy) return;
    setEnhancing(true);
    try {
      const better = await enhanceRequest({ text: t, photoCount: photos.length + pending.length });
      setInput(better);
    } catch (e) {
      const f = friendlyError(e);
      toast?.current?.show({ severity: 'warn', summary: f.title, detail: f.detail, life: 4000 });
    } finally {
      setEnhancing(false);
    }
  }

  async function send(textOverride) {
    const text = (textOverride ?? input).trim();
    const attached = pending;
    if (busy || (!text && attached.length === 0)) return;

    // Earlier turns as plain text for the assistant.
    const history = messages
      .filter((m) => m.text)
      .slice(-12)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

    const nextPhotos = [...photos, ...attached];
    setAtBottom(true);
    setMessages((m) => [...m, { id: nid(), role: 'user', text, images: attached.map((p) => p.src) }]);
    setPhotos(nextPhotos);
    setPending([]);
    setInput('');
    setBusy(true);
    setStatus('Thinking…');

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const turn = await chatTurn({
        history,
        userText: text,
        photos: nextPhotos,
        newCount: attached.length,
        lastPrompt: lastResult?.prompt,
        hasPrevious: !!lastResult,
        signal: ctrl.signal,
      });

      if (!turn.generate) {
        say(turn.reply);
        return;
      }

      say(turn.reply);
      const images = [];
      if (turn.use_previous && lastResult) images.push(lastResult.url);
      for (const n of turn.use_photos) {
        const p = nextPhotos[n - 1];
        if (p) images.push(p.src);
      }

      const t0 = Date.now();
      setLoadPhoto(images[0] ?? null);
      setCreating(true);
      setStatus('Creating your look…');
      const out = await agentJob(
        { prompt: turn.prompt, images: images.slice(0, 6), resolution: '1k', generation_mode: 'balanced' },
        { signal: ctrl.signal, onStatus: setStatus }
      );

      if (!out.images.length) {
        say('I could not create that one. Try describing it a little differently.');
        return;
      }
      setMessages((m) => [
        ...m,
        { id: nid(), role: 'result', text: 'Here is your look. Want anything changed?', images: out.images, prompt: turn.prompt, used: images, seconds: Math.round((Date.now() - t0) / 1000) },
      ]);
      setLastResult({ url: out.images[0], prompt: turn.prompt });
    } catch (e) {
      if (ctrl.signal.aborted) say('Stopped. Send a message whenever you are ready.');
      else {
        const f = friendlyError(e);
        say(`${f.title}. ${f.detail}`);
      }
    } finally {
      setBusy(false);
      setCreating(false);
      setStatus('');
      abortRef.current = null;
    }
  }

  const suggestions = busy ? [] : suggestFor(input, pending, lastResult, messages.length <= 1);

  return (
    <div
      className={`chat ${dragging ? 'drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <header className="chat-head">
        <span className="avatar" aria-hidden="true">✦</span>
        <div>
          <b>AI Studio</b>
          <small>{busy ? status || 'Working on it…' : 'Your styling assistant'}</small>
        </div>
      </header>

      <div
        className="chat-log"
        ref={logRef}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
        }}
      >
        {messages.map((m) => (
          <Message key={m.id} m={m} toast={toast} onOpen={(images, index) => setLightbox({ images, index })} />
        ))}
        {busy && creating && (
          <div className="msg bot loader-msg">
            <FittingLoader image={loadPhoto} status={status} elapsed={elapsed} onCancel={() => abortRef.current?.abort()} />
          </div>
        )}
        {busy && !creating && (
          <div className="msg bot">
            <span className="avatar" aria-hidden="true">✦</span>
            <div className="bubble typing" role="status">
              <span />
              <span />
              <span />
              {status && <small>{status}</small>}
              <small className="elapsed">{elapsed}s</small>
            </div>
          </div>
        )}
        {!atBottom && (
          <button
            type="button"
            className="jump"
            onClick={() => {
              logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
              setAtBottom(true);
            }}
          >
            ↓ New messages
          </button>
        )}
      </div>

      <div className="composer-wrap">
        {suggestions.length > 0 && (
          <div className="suggest" aria-label="Suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => setInput(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="composer">
          {pending.length > 0 && (
            <div className="pending">
              {pending.map((p) => (
                <div className="pending-chip" key={p.id}>
                  <img src={p.src} alt="Attached photo" />
                  <button type="button" aria-label="Remove photo" onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-row">
            <button
              type="button"
              className="attach"
              aria-label="Attach photos"
              onClick={() => fileRef.current?.click()}
              disabled={busy || pending.length >= MAX_PHOTOS}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.5 12.6 20.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
              </svg>
            </button>
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              disabled={busy}
              placeholder={pending.length ? 'Say what to do with these photos…' : 'Describe the look, or add photos…'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onPaste={(e) => {
                const files = [...(e.clipboardData?.files ?? [])];
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
            />
            {busy ? (
              <button type="button" className="send stop" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className="send"
                aria-label="Send"
                onClick={() => send()}
                disabled={!input.trim() && pending.length === 0}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
                </svg>
              </button>
            )}
          </div>

          <div className="composer-foot">
            <button type="button" className="enhance" onClick={enhance} disabled={!input.trim() || enhancing || busy}>
              {enhancing ? 'Improving…' : '✦ Improve my request'}
            </button>
            <small className="composer-hint">Enter to send · Shift+Enter for a new line</small>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(i) => setLightbox((l) => ({ ...l, index: i }))}
          onClose={() => setLightbox(null)}
          onDownload={(url, i) => downloadImage(url, `look-${i + 1}.png`)}
        />
      )}
    </div>
  );
}

function Message({ m, toast, onOpen }) {
  if (m.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          {m.images?.length > 0 && (
            <div className="bubble-photos">
              {m.images.map((src, i) => (
                <button key={i} type="button" className="in-thumb big" onClick={() => onOpen(m.images, i)} aria-label={`Open your photo ${i + 1} full screen`}>
                  <img src={src} alt="Your photo" />
                </button>
              ))}
            </div>
          )}
          {m.text && <p>{m.text}</p>}
        </div>
      </div>
    );
  }

  if (m.role === 'result') return <ResultBubble m={m} toast={toast} onOpen={onOpen} />;

  return (
    <div className="msg bot">
      <span className="avatar" aria-hidden="true">✦</span>
      <div className="bubble">
        <p>{m.text}</p>
      </div>
    </div>
  );
}

