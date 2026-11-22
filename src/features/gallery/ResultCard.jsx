import { notify } from '@/lib/notify.js';
import { Download, Pencil, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderImage, RATIOS, FORMATS, DEFAULT_SETTINGS } from '@/lib/imageTools.js';
import { QA_AREA_LABEL, QA_SOURCE_LABEL, QA_TARGET, qaTone } from '@/lib/qa.js';
import CompareSlider from '@/components/common/CompareSlider.jsx';
import { BOT_NAME } from '@/lib/bot.js';

const KIND_LABEL = { upscale: 'Upscaled', cutout: 'Background removed' };
const RESOLUTIONS = [
  { id: '1k', label: '1K', width: 1024 },
  { id: '2k', label: '2K', width: 2048 },
  { id: '3k', label: '3K', width: 3072 },
  { id: '4k', label: '4K', width: 4096 },
];

/**
 * A generated image: live preview, quick tools, the full tools overlay, and download.
 * onTool(tool, src, opts) runs a dedicated module on this image ('upscale' | 'remove_background').
 */
export default function ResultBubble({ m, onOpen, onTool, onRegenerate, onAttach, onFix, onFeedback, onRegenerateWith, busy = false }) {
  const [s, setS] = useState(DEFAULT_SETTINGS);
  const [preview, setPreview] = useState(null);
  const [imgReady, setImgReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expired, setExpired] = useState(false);
  const [open, setOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [cmpOpen, setCmpOpen] = useState(false);
  const [beforeIdx, setBeforeIdx] = useState(0);
  const [closing, setClosing] = useState(false);
  const [res, setRes] = useState('2k');
  const resWidth = RESOLUTIONS.find((r) => r.id === res).width;
  const closeTimer = useRef(null);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 180);
  }, [closing]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const urlRef = useRef(null);
  const src = m.images[0];
  const key = JSON.stringify(s);

  // The preview is re-rendered with the current settings, so what you see is what you download.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const blob = await renderImage(src, { ...s, width: 900, format: 'jpeg' });
        if (!alive) return;
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setPreview(next);
      } catch {
        // Keep the last good preview.
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key]);

  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);


  // opts lets the overlay download with its own (unsaved) settings.
  async function download(opts = s) {
    setSaving(true);
    try {
      for (let i = 0; i < m.images.length; i++) {
        const blob = await renderImage(m.images[i], opts);
        const url = URL.createObjectURL(blob);
        const f = FORMATS.find((x) => x.id === opts.format) ?? FORMATS[0];
        const a = document.createElement('a');
        a.href = url;
        a.download = `look-${i + 1}.${f.ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (e) {
      console.warn('[studio] download failed', e);
      notify({
        severity: 'warn',
        summary: 'Could not prepare the image',
        detail: 'Try again in a moment. If it keeps failing, right-click the picture and choose Save image.',
        life: 5000,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="msg bot">
      <span className="avatar" aria-hidden="true">✦</span>
      <div className="bubble result">
        <span className="bot-name">{BOT_NAME}</span>
        <p>{m.text}</p>
        {(KIND_LABEL[m.kind] || m.seconds != null) && (
          <small className="gen-time">
            {[KIND_LABEL[m.kind], m.seconds != null && `${m.seconds}s`, m.credits != null && `${m.credits} credit${m.credits === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </small>
        )}

        {expired ? (
          <div className="result-expired" role="note">
            This image is no longer available. Results are kept for about 3 days, so download the ones you want to keep.
          </div>
        ) : (
          <button
            type="button"
            className={`preview-btn ${imgReady ? '' : 'is-loading'}`}
            onClick={() => (m.used?.length ? setCmpOpen(true) : onOpen(m.images, 0))}
            aria-label={m.used?.length ? 'Compare before and after' : 'Open image full screen'}
          >
            <img src={preview ?? src} alt="Your look" className={preview ? 'ready' : 'loading'} loading="eager" decoding="async" onLoad={() => setImgReady(true)} onError={() => !preview && setExpired(true)} />
            <span className="ai-tag">AI-generated</span>
          </button>
        )}
        {m.images.length > 1 && <small className="muted">Showing 1 of {m.images.length}. Download saves all of them.</small>}
        {m.score?.match != null && m.score.match < QA_TARGET && (
          <p className="qa-note" role="status">
            Quality check {m.score.match}%, below the {QA_TARGET}% target.{' '}
            <button type="button" className="qa-link" onClick={() => setQaOpen(true)}>See what is missing</button>
          </p>
        )}

        {!expired && (
          <div className="rb-actions">
            {!expired && onFeedback && <FeedbackBar feedback={m.feedback} busy={busy} onFeedback={onFeedback} onRegenerateWith={onRegenerateWith} />}
            <button type="button" className="rb-btn rb-btn-primary" onClick={() => setOpen(true)} aria-haspopup="dialog">
              <Pencil aria-hidden="true" />
              Edit
            </button>
            <button type="button" className="rb-btn rb-btn-secondary" onClick={() => download()} disabled={saving}>
              <Download aria-hidden="true" />
              {saving ? 'Preparing…' : m.images.length > 1 ? `Download all ${m.images.length}` : 'Download'}
            </button>
            {m.score != null && <QaBadge score={m.score} onOpen={() => setQaOpen(true)} />}
          </div>
        )}

        {m.used?.length > 0 && (
          <div className="used">
            <span>Made from</span>
            {m.used.map((u, i) => (
              <button key={u + i} type="button" className="in-thumb" onClick={() => onOpen(m.used, i)} aria-label={`Open input ${i + 1} full screen`}>
                <img src={u} alt={`Input ${i + 1}`} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}

        {m.prompt && (
          <details>
            <summary>How it was made</summary>
            <p className="muted">{m.prompt}</p>
          </details>
        )}

        {cmpOpen && m.used?.length > 0 &&
          createPortal(
            <div className="pp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setCmpOpen(false)}>
              <div className="qa-panel ba-panel" role="dialog" aria-modal="true" aria-label="Before and after">
                <header className="qa-head">
                  <b>Before and after</b>
                  <span className="ba-head-actions">
                    <button type="button" className="rb-btn rb-btn-secondary" onClick={() => onOpen(m.images, 0)}>
                      Full image
                    </button>
                    <button type="button" className="rso-close" onClick={() => setCmpOpen(false)} aria-label="Close before and after">
                      <X aria-hidden="true" />
                    </button>
                  </span>
                </header>
                <CompareSlider key={beforeIdx} before={m.used[beforeIdx]} after={src} />
                <div className="ba-pick" role="radiogroup" aria-label="Photo to compare with the result">
                  {m.used.map((u, i) => (
                    <button
                      key={u + i}
                      type="button"
                      role="radio"
                      aria-checked={i === beforeIdx}
                      className={`ba-thumb ${i === beforeIdx ? 'on' : ''}`}
                      onClick={() => setBeforeIdx(i)}
                    >
                      <img src={u} alt={`Input ${i + 1}`} />
                    </button>
                  ))}
                </div>
                <p className="qa-disclaimer muted">Drag the line to compare. Before: input {beforeIdx + 1}. After: the generated look.</p>
              </div>
            </div>,
            document.body
          )}

        {qaOpen && m.score?.areas &&
          createPortal(
            <div className="pp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setQaOpen(false)}>
              <div className="qa-panel" role="dialog" aria-modal="true" aria-label="Quality check">
                <header className="qa-head">
                  <b>Quality check</b>
                  <button type="button" className="rso-close" onClick={() => setQaOpen(false)} aria-label="Close quality check">
                    <X aria-hidden="true" />
                  </button>
                </header>
                <div className="qa-summary">
                  <span className={`qa-big tone-${qaTone(m.score.match)}`}>{m.score.match}%</span>
                  <span className="muted">
                    {m.score.match >= QA_TARGET ? `Meets the ${QA_TARGET}% target.` : `Below the ${QA_TARGET}% target. Here is what is missing.`}
                  </span>
                </div>
                <ul className="qa-areas">
                  {Object.entries(m.score.areas).map(([area, v]) => (
                    <li key={area}>
                      <span>{QA_AREA_LABEL[area] ?? area}</span>
                      <span className="qa-bar" aria-hidden="true">
                        <span className={`tone-${qaTone(v)}`} style={{ width: `${v}%` }} />
                      </span>
                      <b>{v}%</b>
                    </li>
                  ))}
                </ul>
                <h6>What is missing</h6>
                {m.score.problems?.length ? (
                  <ol className="qa-problems">
                    {m.score.problems.map((p, i) => (
                      <li key={i}>
                        <b>{QA_AREA_LABEL[p.area] ?? p.area}.</b> {p.detail} <small className="muted">{QA_SOURCE_LABEL[p.source] ?? ''}</small>{onFix && (<button type="button" className="qa-fix" disabled={busy} onClick={() => { setQaOpen(false); onFix(p.detail); }}>Fix this</button>)}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted">No specific problem was found.</p>
                )}
                <p className="qa-disclaimer muted">An automatic check by a model. It can be wrong, so look at the result too.</p>
                {onRegenerate && m.engine && (
                  <div className="qa-actions">
                    <button
                      type="button"
                      className="rb-btn rb-btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        setQaOpen(false);
                        onRegenerate();
                      }}
                    >
                      Make it again
                    </button>
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}

        {open &&
          createPortal(
          <div className={`pp-backdrop ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
            <div className={`pp rso ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Edit this image">
              <header className="rso-head">
                <b>Edit this image</b>
                <button type="button" className="rso-close" onClick={close} aria-label="Close editor" title="Close (Esc)">
                  <X aria-hidden="true" />
                </button>
              </header>
              <div className="rso-body">
                <div className="rso-stage">
                  <img src={preview ?? src} alt="Your look, with the current edits" />
                </div>
                <div className="rso-tools">
                  {(onTool || onRegenerate || onAttach) && (
                    <section className="rb-section" aria-label="Improve this image">
                      <h6>Improve</h6>
                      <div className="tools" role="toolbar" aria-label="Improve this image">
                        {onAttach && <Tool disabled={busy} onClick={() => { setOpen(false); onAttach(src); }} icon="⊕" label="Attach & edit" />}
                        {onRegenerate && m.engine && <Tool disabled={busy} onClick={onRegenerate} icon="⟳" label="Regenerate" />}
                        {onTool && m.kind !== 'upscale' && <Tool disabled={busy} onClick={() => onTool('upscale', src, { resolution: '4k' })} icon="⤢" label="Upscale 4K" />}
                        {onTool && m.kind !== 'cutout' && <Tool disabled={busy} onClick={() => onTool('remove_background', src, {})} icon="◌" label="Remove background" />}
                      </div>
                    </section>
                  )}

                  <section className="rb-section" aria-label="Edit tools">
                    <h6>Crop</h6>
                    <div className="seg seg-wrap" role="radiogroup" aria-label="Crop shape">
                      {RATIOS.map((r) => (
                        <button key={r.id} type="button" role="radio" aria-checked={s.ratio === r.value} className={s.ratio === r.value ? 'on' : ''} onClick={() => setS((v) => ({ ...v, ratio: r.value, cx: 0.5, cy: 0.5, zoom: r.value == null ? 1 : v.zoom }))}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                    {s.ratio != null && (
                      <>
                        <label className="rso-slider"><span>Zoom <b>{s.zoom.toFixed(2)}×</b></span>
                          <input type="range" min="1" max="3" step="0.05" value={s.zoom} onChange={(e) => setS((v) => ({ ...v, zoom: Number(e.target.value) }))} />
                        </label>
                        <label className="rso-slider"><span>Move left / right</span>
                          <input type="range" min="0" max="1" step="0.01" value={s.cx} onChange={(e) => setS((v) => ({ ...v, cx: Number(e.target.value) }))} />
                        </label>
                        <label className="rso-slider"><span>Move up / down</span>
                          <input type="range" min="0" max="1" step="0.01" value={s.cy} onChange={(e) => setS((v) => ({ ...v, cy: Number(e.target.value) }))} />
                        </label>
                      </>
                    )}

                    <h6>Flip and rotate</h6>
                    <div className="tools" role="toolbar" aria-label="Flip and rotate">
                      <Tool active={s.mirror} onClick={() => setS((v) => ({ ...v, mirror: !v.mirror }))} icon="⇋" label="Mirror" />
                      <Tool active={s.flipV} onClick={() => setS((v) => ({ ...v, flipV: !v.flipV }))} icon="⇅" label="Flip" />
                      <Tool onClick={() => setS((v) => ({ ...v, rotate: (v.rotate + 270) % 360 }))} icon="↺" label="Left" />
                      <Tool onClick={() => setS((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }))} icon="↻" label="Right" />
                    </div>

                    <h6>Colour</h6>
                    {[['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturate', 'Saturation']].map(([k, label]) => (
                      <label className="rso-slider" key={k}><span>{label} <b>{s[k]}%</b></span>
                        <input type="range" min={k === 'saturate' ? 0 : 50} max={k === 'saturate' ? 200 : 150} value={s[k]} onChange={(e) => setS((v) => ({ ...v, [k]: Number(e.target.value) }))} />
                      </label>
                    ))}
                    <button type="button" className="rb-btn" disabled={JSON.stringify(s) === JSON.stringify(DEFAULT_SETTINGS)} onClick={() => setS(DEFAULT_SETTINGS)}>Reset edits</button>
                  </section>

                  <section className="rb-section" aria-label="Export">
                    <h6>Export</h6>
                    <div className="seg" role="radiogroup" aria-label="Resolution">
                      {RESOLUTIONS.map((r) => (
                        <button key={r.id} type="button" role="radio" aria-checked={res === r.id} className={res === r.id ? 'on' : ''} onClick={() => setRes(r.id)}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                    <div className="seg" role="radiogroup" aria-label="File format">
                      {FORMATS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={s.format === f.id}
                          className={s.format === f.id ? 'on' : ''}
                          onClick={() => setS((v) => ({ ...v, format: f.id }))}
                        >
                          {f.id.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="rb-btn rb-btn-secondary rb-btn-block" onClick={() => download({ ...s, width: resWidth })} disabled={saving}>
                      <Download aria-hidden="true" />
                      {saving ? 'Preparing…' : m.images.length > 1 ? `Download all ${m.images.length}` : 'Download'}
                    </button>
                  </section>
                </div>
              </div>
            </div>
          </div>,
          document.body
          )}

      </div>
    </div>
  );
}

const FIX_REASONS = ['Wrong garment', 'Extra garment added', 'Wrong pose', 'Wrong colour', 'Face or body changed', 'Wrong framing'];

/** Thumbs up or down on a result. Thumbs down asks what is wrong, then regenerates with those fixes. */
function FeedbackBar({ feedback, busy, onFeedback, onRegenerateWith }) {
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState([]);
  const [note, setNote] = useState('');
  const toggle = (r) => setReasons((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  const extra = note.trim();
  return (
    <div className="fb">
      <div className="fb-row" role="group" aria-label="Rate this look">
        <button type="button" className={`fb-btn ${feedback?.rating === 'up' ? 'on' : ''}`} aria-pressed={feedback?.rating === 'up'} onClick={() => { setOpen(false); onFeedback({ rating: 'up', reasons: [], note: '' }); }}>
          <ThumbsUp aria-hidden="true" /> Good
        </button>
        <button type="button" className={`fb-btn ${feedback?.rating === 'down' || open ? 'on' : ''}`} aria-pressed={open} onClick={() => setOpen((o) => !o)}>
          <ThumbsDown aria-hidden="true" /> Needs a fix
        </button>
      </div>
      {open && (
        <div className="fb-panel">
          <p className="fb-q">What is wrong?</p>
          <div className="fb-reasons">
            {FIX_REASONS.map((r) => (
              <button key={r} type="button" className={`fb-chip ${reasons.includes(r) ? 'on' : ''}`} aria-pressed={reasons.includes(r)} onClick={() => toggle(r)}>
                {r}
              </button>
            ))}
          </div>
          <input className="fb-note" value={note} maxLength={200} placeholder="Anything else? (optional)" aria-label="Anything else about this look (optional)" onChange={(e) => setNote(e.target.value)} />
          <Button type="button" variant="primary" disabled={busy || (reasons.length === 0 && !extra)} onClick={() => {
            const fixes = [...reasons, extra].filter(Boolean).join('; ');
            onFeedback({ rating: 'down', reasons, note: extra });
            setOpen(false);
            onRegenerateWith?.(fixes);
          }}>
            Regenerate with these fixes
          </Button>
        </div>
      )}
      {feedback?.rating === 'up' && <p className="fb-thanks">Thanks for the feedback.</p>}
    </div>
  );
}

function QaBadge({ score, onOpen }) {
  if (score.pending) {
    return (
      <span className="qa-badge pending" role="status">
        <span className="qa-spin" aria-hidden="true" />
        Checking
      </span>
    );
  }
  const tone = qaTone(score.match);
  return (
    <button type="button" className={`qa-badge tone-${tone}`} onClick={onOpen} aria-label={`Quality score ${score.match} out of 100. Show details`} title="See what is missing">
      <span className="qa-dot" aria-hidden="true" />
      {score.match}/100
    </button>
  );
}

function Tool({ icon, label, active, disabled, onClick }) {
  return (
    <button type="button" className={`tool ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={active ? true : undefined}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}
