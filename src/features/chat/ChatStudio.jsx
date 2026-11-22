import { useCallback, useEffect, useRef, useState } from 'react';
import PhotoPreview from '@/components/common/PhotoPreview.jsx';
import QuickActionCard from '@/components/common/QuickActionCard.jsx';
import {
  ArrowUp, Check, CircleStop, Download, Eraser, Footprints, History, ImageIcon, Loader2, Maximize2, MessageSquare, Palette, Paperclip, Pencil,
  PersonStanding, Plus, RotateCcw, Scan, Search, Shirt, Sparkles, Square, SquarePen, Table2, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx';
import { Input } from '@/components/ui/input.jsx';
import { notify } from '@/lib/notify.js';
import { BOT_NAME } from '@/lib/bot.js';
import Lightbox from '@/components/common/Lightbox.jsx';
import PageLoader from '@/components/common/PageLoader.jsx';
import FittingLoader from '@/components/common/FittingLoader.jsx';
import { downloadImage } from '@/api/fashn.js';
import { prepareFile } from '@/lib/imageIntake.js';
import { shrinkDataURI } from '@/lib/imageShrink.js';
import { backendEnhanceRequest as enhanceRequest, backendAnalyzePhoto } from '@/api/backend.js';
import { friendlyError } from '@/lib/messages.js';
import { useAuth } from '@/auth/context/AuthContext.jsx';
import ResultBubble from '@/features/gallery/ResultCard.jsx';
import { useChat } from './ChatProvider.jsx';
import { uid } from './chatReducer.js';

const MAX_PHOTOS = 8;
const WELCOME_SUGGESTIONS = ['Dress a model in my garment', 'Put these shoes on the model', 'Change the background to a studio'];
const PHOTO_SUGGESTIONS = ['Put these on the model', 'Use this as the background', 'Upscale this to 4K'];
const RESULT_SUGGESTIONS = ['Upscale to 4K', 'Remove the background', 'Change the colour', 'Different pose', 'Make it full body'];
const MORE_SUGGESTIONS = ['Full body, front view', 'Plain grey studio background', 'Make the top and bottom match', 'Upscale and download'];

// A small icon for each suggestion tag, picked from its words.
const TAG_ICONS = [
  [/upscale|4k|hd/i, Maximize2],
  [/download/i, Download],
  [/remove the background/i, Eraser],
  [/background|studio/i, ImageIcon],
  [/colou?r/i, Palette],
  [/pose/i, PersonStanding],
  [/full body|front view/i, Scan],
  [/shoes/i, Footprints],
  [/dress|garment|top|put these|wear/i, Shirt],
];
const suggestIcon = (text) => TAG_ICONS.find(([re]) => re.test(text))?.[1] ?? Sparkles;

/** Suggestions for the current moment, plus any that match what the user is typing. */
function suggestFor(input, pending, lastResult, onlyWelcome) {
  const base = pending.length ? PHOTO_SUGGESTIONS : lastResult ? RESULT_SUGGESTIONS : onlyWelcome ? WELCOME_SUGGESTIONS : [];
  const words = input.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const typed = words.length ? [...RESULT_SUGGESTIONS, ...WELCOME_SUGGESTIONS, ...MORE_SUGGESTIONS].filter((s) => words.some((w) => s.toLowerCase().includes(w))) : [];
  return [...new Set([...typed, ...base])].slice(0, 5);
}

/** Seconds since `startedAt`, ticking while a job runs. */
function useElapsed(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

/** Short tags for a photo's analysis, shown in the preview. */
const PHOTO_ROLES = [
  ['model', 'Model'],
  ['garment', 'Garment'],
  ['shoes', 'Shoes'],
  ['accessory', 'Accessory'],
  ['background', 'Background'],
  ['pose', 'Pose'],
  ['logo', 'Logo'],
  ['other', 'Other'],
];

/** Soft warnings under a photo. The user can still send it; these only point out likely problems. */
export function photoWarnings(meta, text = '', size = null) {
  const out = [];
  if (size && Math.min(size.w, size.h) < 768) out.push('Small photo: under 768 px. The result may be softer.');
  if (meta?.role === 'model' && meta.shot && meta.shot !== 'full_body' && /full[\s-]?body|head to (toe|feet)/i.test(text)) {
    out.push('This photo is not full body, but your request asks for a full body.');
  }
  if (meta?.role === 'garment' && meta.unclear) out.push(`Not visible: ${String(meta.unclear).slice(0, 80)}`);
  if (meta?.role === 'garment' && meta.view === 'back') out.push('Only the back of this garment is visible.');
  return out;
}

const SHOT_LABEL = { full_body: 'full body', cropped_head: 'head cropped', three_quarter: 'knees up', half_body: 'half body', close_up: 'close-up' };
const LENGTH_LABEL = { upper: 'top', lower: 'bottom', full: 'full length' };

/** Short labels shown under a photo: a model shows gender, pose and shot; a garment shows type, colour and length. */
function tagsOf(meta) {
  if (!meta) return [];
  const known = (v) => v && v !== 'unknown';
  if (meta.role === 'model') return [meta.person === 'mannequin' ? 'mannequin' : null, known(meta.gender) ? meta.gender : null, meta.pose, SHOT_LABEL[meta.shot]].filter(Boolean);
  if (meta.role === 'garment') return [meta.type, meta.color, LENGTH_LABEL[meta.length]].filter(Boolean);
  return [meta.role, meta.type, meta.color].filter(Boolean);
}

// Quick-start cards for an empty chat. Each one either fills the composer or opens an existing page.
const QUICK_ACTIONS = [
  { label: 'Try an outfit', hint: 'Dress a model in a garment', icon: Shirt, text: 'Dress a model in my garment' },
  { label: 'Change background', hint: 'Studio or custom setting', icon: ImageIcon, text: 'Change the background to a studio' },
  { label: 'Upscale image', hint: 'Sharper, up to 4K', icon: Maximize2, text: 'Upscale this to 4K' },
  { label: 'Remove background', hint: 'Transparent cut-out', icon: Eraser, text: 'Remove the background' },
  { label: 'Bulk generation', hint: 'Models × garments grid', icon: Table2, soon: true },
];

function QuickActions({ onPick, onOpenPage }) {
  return (
    <section className="chat-hero" aria-labelledby="hero-title">
      <span className="avatar hero-avatar" aria-hidden="true">✦</span>
      <h3 id="hero-title">What are we styling today?</h3>
      <p>Describe a look, add photos, or start with a quick action.</p>
      <div className="quick-actions" role="group" aria-label="Quick start">
        {QUICK_ACTIONS.map(({ label, hint, icon, text, soon }) => (
          <QuickActionCard key={label} icon={icon} title={label} hint={hint} disabled={soon} onClick={() => onPick(text)} />
        ))}
      </div>
    </section>
  );
}

export default function ChatStudio({ onNavigate }) {
  const { state, active, run, send, runTool, resend, regenerate, stop, newChat, selectChat, deleteChat } = useChat();
  const [pending, setPending] = useState([]); // photos attached to the message being written
  const [photoMeta, setPhotoMeta] = useState({}); // { [photoId]: analysis } — populated async on upload
  const [photoSizes, setPhotoSizes] = useState({}); // { [photoId]: { w, h } } read when each thumbnail loads
  const [preview, setPreview] = useState(null); // { src, alt, tags } for the shared photo preview
  const closePreview = useCallback(() => setPreview(null), []);
  const setPhotoRole = (id, role) => setPhotoMeta((m) => ({ ...m, [id]: { ...m[id], role_user: role, role } }));
  const [editOn, setEditOn] = useState(true); // the next message changes the last look (same image, same resolution)
  const [input, setInput] = useState('');
  const [enhancing, setEnhancing] = useState(false);
  const [lightbox, setLightbox] = useState(null); // {images, index}
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const logRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  const busy = !!run; // one job at a time, in any chat
  const busyHere = run?.chatId === active?.id;
  const isEmpty = !busy && (active?.messages.length ?? 0) <= 1;
  const elapsed = useElapsed(run?.startedAt);

  // A different chat starts with an empty composer, scrolled to the end.
  useEffect(() => {
    setPhotoMeta({});
    setEditOn(true);
    setPending([]);
    setInput('');
    setAtBottom(true);
  }, [active?.id]);

  // Follow the conversation only while the reader is at the bottom.
  useEffect(() => {
    if (atBottom) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [active?.messages, busyHere, atBottom]);

  // When a job ends, give keyboard focus back to the message box if it was lost.
  useEffect(() => {
    if (!busy && (document.activeElement === document.body || document.activeElement == null)) taRef.current?.focus();
  }, [busy]);

  // The text box grows with the text instead of scrolling inside a small box.
  useEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 320)}px`;
  }, [input]);

  if (!state.loaded || !active) return <PageLoader />;

  async function addFiles(fileList) {
    const files = [...(fileList ?? [])];
    if (!files.length) return;
    const room = MAX_PHOTOS - pending.length;
    if (room <= 0) return notify({ severity: 'warn', summary: 'Photos', detail: `You can attach up to ${MAX_PHOTOS} photos per message.` });
    const results = await Promise.allSettled(files.slice(0, room).map((f) => prepareFile(f)));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => ({ id: uid(), src: r.value.src }));
    const bad = results.find((r) => r.status === 'rejected');
    if (bad) notify({ severity: 'warn', summary: 'Photo', detail: bad.reason?.message });
    if (files.length > room) notify({ severity: 'warn', summary: 'Photos', detail: `Only ${room} more photo(s) fit in this message.` });
    if (ok.length) {
      setPending((p) => [...p, ...ok]);
      // Analyze each photo in the background — failures are silently ignored.
      ok.forEach(({ id, src }) => {
        shrinkDataURI(src).then((small) => backendAnalyzePhoto({ src: small })).then((meta) => {
          if (meta && Object.keys(meta).length) setPhotoMeta((m) => ({ ...m, [id]: meta }));
        });
      });
    }
  }

  async function enhance() {
    const t = input.trim();
    if (!t || enhancing || busy) return;
    setEnhancing(true);
    try {
      setInput(await enhanceRequest({ text: t, photoCount: active.photos.length + pending.length }));
    } catch (e) {
      const f = friendlyError(e);
      notify({ severity: 'warn', summary: f.title, detail: f.detail });
    } finally {
      setEnhancing(false);
    }
  }

  /** Puts a generated image into the composer, so the next message changes it. */
  function attachResult(src) {
    if (pending.length >= MAX_PHOTOS) return notify({ severity: 'warn', summary: 'Photos', detail: `You can attach up to ${MAX_PHOTOS} photos per message.` });
    setPending((p) => [...p, { id: uid(), src }]);
    notify({ severity: 'info', summary: 'Added to your message', detail: 'Type the change you want, then send.', life: 3000 });
    taRef.current?.focus();
  }

  function submit(textOverride) {
    const text = (textOverride ?? input).trim();
    if (busy || (!text && !pending.length)) return;
    setAtBottom(true);
    const isLastAttached = pending.some((p) => p.src === active.lastResult?.url);
    const editOf = editOn && active.lastResult && !isLastAttached ? active.lastResult : null;
    send(active.id, text, pending, photoMeta, editOf);
    setPending([]);
    setPhotoMeta({});
    setInput('');
  }

  const suggestions = busy ? [] : suggestFor(input, pending, active.lastResult, false);

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
          <span className={`avatar ${busyHere ? 'is-thinking' : ''}`} aria-hidden="true">✦</span>
          <div className="chat-title">
            <h2 id="chat-title">{active.title}</h2>
            <p className="chat-status" role="status">
              {busyHere ? run.status || 'Working on it…' : busy ? 'Busy in another chat…' : 'Your styling assistant'}
            </p>
          </div>
          <div className="chat-actions">
            <SessionMenu state={state} run={run} onSelect={selectChat} onDelete={deleteChat} />
            <button
              type="button"
              className="icon-btn"
              onClick={newChat}
              disabled={active.messages.length <= 1}
              data-tip={active.messages.length <= 1 ? 'Already a new chat' : 'New chat'}
              aria-label="New chat"
            >
              <SquarePen aria-hidden="true" />
            </button>
          </div>
        </header>

        <div
          className="chat-log"
          ref={logRef}
          role="log"
          aria-labelledby="chat-title"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
          }}
        >
          {isEmpty && (
            <QuickActions
              onPick={(text) => {
                setInput(text);
                taRef.current?.focus();
              }}
              onOpenPage={(page) => onNavigate?.(page)}
            />
          )}
          {!isEmpty && active.messages.filter((m) => m.id !== 'welcome').map((m) => (
            <Message
              key={m.id}
              m={m}
              busy={busy}
              onOpen={(images, index) => setLightbox({ images, index })}
              onTool={(tool, src, opts) => runTool(active.id, { tool, src, ...opts })}
              onRegenerate={() => regenerate(active.id, m.id)}
              onFix={(detail) => send(active.id, `Fix: ${detail}`, [], photoMeta, { url: m.images[0], prompt: m.prompt, resolution: m.resolution })}
              onAttach={attachResult}
              onResend={(text) => {
                setAtBottom(true);
                resend(active.id, m.id, text);
              }}
            />
          ))}
          {busyHere && run.creating && (
            <div className="msg bot loader-msg">
              <FittingLoader image={run.photo} status={run.status} elapsed={elapsed} onCancel={stop} />
            </div>
          )}
          {busyHere && !run.creating && (
            <div className="msg bot">
              <span className="avatar is-thinking" aria-hidden="true">✦</span>
              <div className="bubble typing" role="status">
                <span />
                <span />
                <span />
                {run.status && <small>{run.status}</small>}
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

        <div className="cwrap">
          {suggestions.length > 0 && (
            <div className="ctags" role="group" aria-label="Suggestions">
              {suggestions.map((s) => {
                const Icon = suggestIcon(s);
                return (
                  <button
                    key={s}
                    type="button"
                    className="ctag"
                    onClick={() => {
                      setInput(s);
                      taRef.current?.focus();
                    }}
                  >
                    <Icon aria-hidden="true" />
                    {s}
                  </button>
                );
              })}
            </div>
          )}

          {editOn && active.lastResult && (
            <div className="edit-chip" role="status">
              <img src={active.lastResult.url} alt="" />
              <span className="edit-chip-text">
                <b>{pending.length ? `Adding ${pending.length} photo${pending.length > 1 ? 's' : ''} to the last look` : 'Changing the last look'}</b>
                <small>
                  {pending.length
                    ? 'Your photos are combined with this image, at the same resolution.'
                    : 'Type the change. The same image and resolution are used.'}
                </small>
              </span>
              <button type="button" className="edit-chip-x" onClick={() => setEditOn(false)} aria-label="Start a new look instead" data-tip="Start a new look">
                <X aria-hidden="true" />
              </button>
            </div>
          )}

          <div className={`cbox ${busy ? 'is-busy' : ''}`}>
            {pending.length > 0 && (
              <div className="cattach" role="group" aria-label={`${pending.length} of ${MAX_PHOTOS} photos attached`}>
                {pending.map((p, i) => {
                  const meta = photoMeta[p.id];
                  const tags = meta ? tagsOf(meta).slice(0, 3) : null;
                  return (
                    <div className="cattach-item" key={p.id}>
                      <div className="cattach-thumb">
                        <button type="button" className="cattach-open" onClick={() => setPreview({ src: p.src, alt: `Attached photo ${i + 1}`, tags: tagsOf(meta), photoId: p.id })} aria-label={`Preview attached photo ${i + 1}`}>
                          <img
                            src={p.src}
                            alt=""
                            onLoad={(e) => {
                              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                              setPhotoSizes((s) => ({ ...s, [p.id]: { w, h } }));
                            }}
                          />
                        </button>
                        {tags ? (
                          <div className="cattach-overlay" aria-label={tags.join(', ')}>
                            {tags.slice(0, 1).map((t) => (
                              <span key={t} className="cattach-chip">
                                {t}
                              </span>
                            ))}
                            {tagsOf(meta).length > 1 && <span className="cattach-chip cattach-more">+{tagsOf(meta).length - 1}</span>}
                          </div>
                        ) : (
                          <div className="cattach-overlay cattach-overlay--analyzing" aria-label="Analysing">
                            <Loader2 className="cattach-spin" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                      <button type="button" className="cattach-remove" aria-label={`Remove attached photo ${i + 1}`} onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))}>
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
                {pending.length < MAX_PHOTOS && (
                  <button type="button" className="cattach-add" aria-label="Attach more photos" onClick={() => fileRef.current?.click()} disabled={busy}>
                    <Plus aria-hidden="true" />
                  </button>
                )}
                <span className="cattach-count" aria-hidden="true">
                  {pending.length}/{MAX_PHOTOS}
                </span>
              </div>
            )}

            <textarea
              ref={taRef}
              className="cbox-input"
              rows={1}
              value={input}
              readOnly={busy}
              aria-disabled={busy || undefined}
              aria-label="Message"
              placeholder={busy && !busyHere ? 'Wait for the other chat to finish…' : pending.length ? 'Say what to do with these photos…' : 'Describe the look, or add photos…'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
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

            <div className="cbox-bar">
              <button
                type="button"
                className="cbtn"
                aria-label="Attach photos"
                data-tip={editOn && active.lastResult ? 'Add photos to the last look' : 'Attach photos'}
                onClick={() => fileRef.current?.click()}
                disabled={busy || pending.length >= MAX_PHOTOS}
              >
                <Paperclip aria-hidden="true" />
                <span className="cbtn-label">Photos</span>
              </button>
              <button type="button" className="cbtn cbtn-text" onClick={enhance} disabled={!input.trim() || enhancing || busy}>
                {enhancing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {enhancing ? 'Improving…' : 'Improve'}
              </button>
              {busyHere ? (
                <button type="button" className="csend stop" aria-label="Stop" onClick={stop}>
                  <Square aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="csend" aria-label="Send" onClick={() => submit()} disabled={busy || (!input.trim() && !pending.length)}>
                  <ArrowUp aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {preview && (
          <PhotoPreview
            src={preview.src}
            alt={preview.alt}
            tags={preview.tags}
            onClose={closePreview}
            roleValue={photoMeta[preview.photoId]?.role_user ?? photoMeta[preview.photoId]?.role ?? 'other'}
            roleOptions={PHOTO_ROLES}
            onRoleChange={(role) => setPhotoRole(preview.photoId, role)}
            warnings={photoWarnings(photoMeta[preview.photoId], input, photoSizes[preview.photoId])}
          />
        )}
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

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Chat header title that opens the list of saved chats (switch, search, delete with a confirm step).
 * Keeps the whole page width for the conversation.
 */
function SessionMenu({ state, run, onSelect, onDelete }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const count = state.order.length;
  const q = query.trim().toLowerCase();
  const ids = state.order.filter((id) => !q || state.chats[id].title.toLowerCase().includes(q));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery('');
          setConfirmId(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        {/* native button: Radix needs a ref on the trigger (shadcn's Button does not forward refs on React 18) */}
        <button type="button" className="icon-btn" data-tip="Chat history" aria-label={`Chat history, ${count} chat${count === 1 ? '' : 's'}`}>
          <History aria-hidden="true" />
          {count > 1 && (
            <span className="icon-badge" aria-hidden="true">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="session-menu w-[min(380px,calc(100vw-2rem))] p-0">
        <div className="session-search">
          <Search className="size-4" aria-hidden="true" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats…" aria-label="Search chats" className="h-8 border-0 shadow-none focus-visible:ring-0" />
        </div>

        <ul className="session-list" aria-label="Saved chats">
          {ids.length === 0 && <li className="session-empty">No chats match “{query}”.</li>}
          {ids.map((id) => {
            const c = state.chats[id];
            const on = id === state.activeId;
            return (
              <li key={id} className={on ? 'on' : ''}>
                {confirmId === id ? (
                  <div className="session-confirm" role="group" aria-label="Confirm delete">
                    <span>Delete “{c.title}”?</span>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        onDelete(id);
                        setConfirmId(null);
                      }}
                    >
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="session-item"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => {
                        onSelect(id);
                        setOpen(false);
                      }}
                    >
                      {run?.chatId === id ? <Loader2 className="size-4 animate-spin" aria-label="Working" /> : <MessageSquare className="size-4" aria-hidden="true" />}
                      <span>
                        <b>{c.title}</b>
                        <small>{timeAgo(c.updatedAt)}</small>
                      </span>
                      {on && <Check className="size-4 shrink-0" aria-hidden="true" />}
                    </button>
                    <button type="button" className="session-del" aria-label={`Delete chat ${c.title}`} onClick={() => setConfirmId(id)}>
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className="session-note">Chats are saved in this browser for your account.</p>
      </PopoverContent>
    </Popover>
  );
}

function Message({ m, busy, onOpen, onTool, onRegenerate, onAttach, onResend, onFix }) {
  if (m.role === 'user') return <UserMessage m={m} busy={busy} onOpen={onOpen} onResend={onResend} />;

  if (m.role === 'result') return <ResultBubble m={m} onOpen={onOpen} onTool={onTool} onRegenerate={onRegenerate} onAttach={onAttach} onFix={onFix} busy={busy} />;

  return (
    <div className="msg bot">
      <span className="avatar" aria-hidden="true">✦</span>
      <div className="bubble">
        <span className="sr-only">Assistant: </span>
        <span className="bot-name">{BOT_NAME}</span>
        <p>{m.text}</p>
      </div>
    </div>
  );
}

/**
 * The user's message. If its turn failed or was stopped, it shows why, with Retry and Edit
 * (edit happens in place: Enter or "Send" resends, Escape or "Cancel" keeps the original).
 */
function UserMessage({ m, busy, onOpen, onResend }) {
  const { user } = useAuth();
  const initial = (user?.name ?? '?').trim().charAt(0).toUpperCase();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const editRef = useRef(null);
  const issueId = `issue-${m.id}`;
  const unfinished = m.status === 'failed' || m.status === 'stopped';
  const canSend = !busy && (draft.trim() || m.images?.length);

  useEffect(() => {
    if (!editing) return;
    const t = editRef.current;
    t?.focus();
    t?.setSelectionRange(t.value.length, t.value.length);
  }, [editing]);

  function submitEdit(e) {
    e?.preventDefault();
    if (!canSend) return;
    setEditing(false);
    onResend(draft.trim());
  }

  return (
    <div className={`msg user ${unfinished ? 'unfinished' : ''}`}>
      <span className="avatar user-avatar" aria-hidden="true">{initial}</span>
      <div className="msg-col">
        <div className={`bubble ${editing ? 'editing' : ''}`} aria-describedby={unfinished ? issueId : undefined}>
          <span className="sr-only">You: </span>
          {m.images?.length > 0 && (
            <div className="bubble-photos">
              {m.images.map((src, i) => (
                <button key={i} type="button" className="in-thumb big" onClick={() => onOpen(m.images, i)} aria-label={`Open your photo ${i + 1} full screen`}>
                  <img src={src} alt={`Your photo ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
          {editing ? (
            <form className="edit-form" onSubmit={submitEdit}>
              <label className="sr-only" htmlFor={`edit-${m.id}`}>
                Edit your message
              </label>
              <textarea
                id={`edit-${m.id}`}
                ref={editRef}
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditing(false);
                  } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submitEdit(e);
                }}
              />
              <div className="edit-actions">
                <button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={!canSend}>
                  Send
                </button>
              </div>
            </form>
          ) : (
            m.text && <p>{m.text}</p>
          )}
        </div>

        {unfinished && !editing && (
          <div className={`msg-issue ${m.status}`} id={issueId} role={m.status === 'failed' ? 'alert' : undefined}>
            {m.status === 'failed' ? <TriangleAlert className="size-4 shrink-0" aria-hidden="true" /> : <CircleStop className="size-4 shrink-0" aria-hidden="true" />}
            <span>{m.status === 'failed' ? `Not completed. ${m.error ?? 'Something went wrong.'}` : 'Stopped before it finished.'}</span>
            <span className="msg-issue-actions">
              <button type="button" onClick={() => onResend()} disabled={busy}>
                <RotateCcw className="size-3.5" aria-hidden="true" /> Retry
              </button>
              {!m.tool && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(m.text);
                    setEditing(true);
                  }}
                  disabled={busy}
                >
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
