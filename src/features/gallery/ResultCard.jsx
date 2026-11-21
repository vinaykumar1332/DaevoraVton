import { notify } from '@/lib/notify.js';
import { Download, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderImage, RATIOS, FORMATS, DEFAULT_SETTINGS } from '@/lib/imageTools.js';

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
export default function ResultBubble({ m, onOpen, onTool, onRegenerate, onAttach, busy = false }) {
  const [s, setS] = useState(DEFAULT_SETTINGS);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expired, setExpired] = useState(false);
  const [open, setOpen] = useState(false);
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
          <button type="button" className="preview-btn" onClick={() => onOpen(m.images, 0)} aria-label="Open image full screen">
            <img src={preview ?? src} alt="Your look" className={preview ? 'ready' : 'loading'} onError={() => !preview && setExpired(true)} />
          </button>
        )}
        {m.images.length > 1 && <small className="muted">Showing 1 of {m.images.length}. Download saves all of them.</small>}

        {!expired && (
          <div className="rb-actions">
            <button type="button" className="rb-btn rb-btn-primary" onClick={() => setOpen(true)} aria-haspopup="dialog">
              <Pencil aria-hidden="true" />
              Edit
            </button>
            <button type="button" className="rb-btn rb-btn-secondary" onClick={() => download()} disabled={saving}>
              <Download aria-hidden="true" />
              {saving ? 'Preparing…' : m.images.length > 1 ? `Download all ${m.images.length}` : 'Download'}
            </button>
          </div>
        )}

        {m.used?.length > 0 && (
          <div className="used">
            <span>Made from</span>
            {m.used.map((u, i) => (
              <button key={u + i} type="button" className="in-thumb" onClick={() => onOpen(m.used, i)} aria-label={`Open input ${i + 1} full screen`}>
                <img src={u} alt={`Input ${i + 1}`} />
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

function Tool({ icon, label, active, disabled, onClick }) {
  return (
    <button type="button" className={`tool ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={active ? true : undefined}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}
