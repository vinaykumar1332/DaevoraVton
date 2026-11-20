import { useEffect, useRef, useState } from 'react';
import { renderImage, cropRect, RATIOS, WIDTHS, FORMATS, DEFAULT_SETTINGS } from '@/lib/imageTools.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sameAs = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A generated look: live preview, quick tools, the full tools overlay, and download. */
export default function ResultBubble({ m, toast, onOpen }) {
  const [s, setS] = useState(DEFAULT_SETTINGS);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const changed = !sameAs(s, DEFAULT_SETTINGS);
  const summary = [
    s.ratio != null && `${RATIOS.find((r) => r.value === s.ratio)?.label} crop`,
    s.mirror && 'mirrored',
    s.flipV && 'flipped',
    s.rotate ? `rotated ${s.rotate}°` : null,
    s.brightness !== 100 || s.contrast !== 100 || s.saturate !== 100 ? 'colour adjusted' : null,
    s.width ? `${s.width}px wide` : null,
    FORMATS.find((f) => f.id === s.format)?.id.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' · ');

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
      toast?.current?.show({
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
        {m.seconds != null && <small className="gen-time">Created in {m.seconds}s</small>}

        <button type="button" className="preview-btn" onClick={() => onOpen(m.images, 0)} aria-label="Open look full screen">
          <img src={preview ?? src} alt="Your look" className={preview ? 'ready' : 'loading'} />
        </button>
        {m.images.length > 1 && <small className="muted">Showing 1 of {m.images.length}. Download saves all of them.</small>}

        <div className="tools" role="toolbar" aria-label="Quick tools">
          <Tool active={s.mirror} onClick={() => setS((v) => ({ ...v, mirror: !v.mirror }))} icon="⇋" label="Mirror" />
          <Tool onClick={() => setS((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }))} icon="↻" label="Rotate" />
          <Tool onClick={() => setEditing(true)} icon="⛶" label="All tools" />
          <Tool disabled={!changed} onClick={() => setS(DEFAULT_SETTINGS)} icon="↺" label="Reset" />
        </div>

        <div className="dl">
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
          <button type="button" className="primary" onClick={() => download()} disabled={saving}>
            {saving ? 'Preparing…' : m.images.length > 1 ? `Download all ${m.images.length}` : 'Download'}
          </button>
        </div>
        <small className="muted summary">{summary || 'Original look, no changes'}</small>

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

        {editing && (
          <Editor
            url={src}
            initial={s}
            onApply={(next) => {
              setS(next);
              setEditing(false);
            }}
            onDownload={(next) => download(next)}
            onClose={() => setEditing(false)}
          />
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

/** Full tools overlay: crop frame, flips, rotation, colour, size and format, with download. */
function Editor({ url, initial, onApply, onDownload, onClose }) {
  const [s, setS] = useState(initial);
  const [preview, setPreview] = useState(null);
  const [dims, setDims] = useState(null);
  const stageRef = useRef(null);
  const drag = useRef(null);
  const previewKey = JSON.stringify({ m: s.mirror, f: s.flipV, r: s.rotate, b: s.brightness, c: s.contrast, sa: s.saturate });

  // The preview shows every change except the crop, so the crop frame lines up with the image.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await renderImage(url, {
          ...DEFAULT_SETTINGS,
          mirror: s.mirror,
          flipV: s.flipV,
          rotate: s.rotate,
          brightness: s.brightness,
          contrast: s.contrast,
          saturate: s.saturate,
          width: 1100,
          format: 'jpeg',
        });
        if (!alive) return;
        const next = URL.createObjectURL(blob);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return next;
        });
      } catch {
        // keep the previous preview
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, previewKey]);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const frame = dims && s.ratio != null ? cropRect(dims.w, dims.h, s) : null;
  const pct = frame && {
    left: (frame.sx / dims.w) * 100,
    top: (frame.sy / dims.h) * 100,
    width: (frame.sw / dims.w) * 100,
    height: (frame.sh / dims.h) * 100,
  };

  function onDown(e) {
    drag.current = { x: e.clientX, y: e.clientY, cx: s.cx, cy: s.cy };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    const d = drag.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = (e.clientX - d.x) / rect.width;
    const dy = (e.clientY - d.y) / rect.height;
    setS((v) => ({ ...v, cx: clamp(d.cx + dx, 0, 1), cy: clamp(d.cy + dy, 0, 1) }));
  }
  const onUp = () => (drag.current = null);

  const slider = (key, label, min, max, step = 1, unit = '') => (
    <label className="ed-slider">
      <span>
        {label} <b>{s[key]}{unit}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={s[key]} onChange={(e) => setS((v) => ({ ...v, [key]: Number(e.target.value) }))} />
    </label>
  );

  return (
    <div className="ed-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed" role="dialog" aria-modal="true" aria-label="All tools">
        <header className="ed-head">
          <b>Tools</b>
          <button type="button" className="ed-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="ed-body">
          <div className="ed-stage" ref={stageRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {preview ? (
              <img src={preview} alt="" onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            ) : (
              <div className="ed-loading">Loading…</div>
            )}
            {pct && (
              <div
                className="ed-frame"
                style={{ left: `${pct.left}%`, top: `${pct.top}%`, width: `${pct.width}%`, height: `${pct.height}%` }}
                onPointerDown={onDown}
                aria-label="Drag to move the crop"
              />
            )}
          </div>

          <div className="ed-panel">
            <section>
              <h5>Crop shape</h5>
              <div className="chips">
                {RATIOS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={s.ratio === r.value ? 'on' : ''}
                    onClick={() => setS((v) => ({ ...v, ratio: r.value, cx: 0.5, cy: 0.5, zoom: r.value == null ? 1 : v.zoom }))}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <label className="ed-slider">
                <span>
                  Zoom <b>{s.zoom.toFixed(2)}×</b>
                </span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={s.zoom}
                  disabled={s.ratio == null}
                  onChange={(e) => setS((v) => ({ ...v, zoom: Number(e.target.value) }))}
                />
              </label>
              <small className="muted">{s.ratio == null ? 'Pick a shape to crop. Drag the frame to move it.' : 'Drag the frame on the image to choose the part to keep.'}</small>
            </section>

            <section>
              <h5>Flip &amp; rotate</h5>
              <div className="chips">
                <button type="button" className={s.mirror ? 'on' : ''} onClick={() => setS((v) => ({ ...v, mirror: !v.mirror }))}>
                  ⇋ Mirror
                </button>
                <button type="button" className={s.flipV ? 'on' : ''} onClick={() => setS((v) => ({ ...v, flipV: !v.flipV }))}>
                  ⇅ Flip
                </button>
                <button type="button" onClick={() => setS((v) => ({ ...v, rotate: (v.rotate + 270) % 360 }))}>↺ Left</button>
                <button type="button" onClick={() => setS((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }))}>↻ Right</button>
              </div>
            </section>

            <section>
              <h5>Colour</h5>
              {slider('brightness', 'Brightness', 50, 150, 1, '%')}
              {slider('contrast', 'Contrast', 50, 150, 1, '%')}
              {slider('saturate', 'Saturation', 0, 200, 1, '%')}
            </section>

            <section>
              <h5>Output width</h5>
              <div className="chips">
                {WIDTHS.map((w) => (
                  <button key={w ?? 'orig'} type="button" className={s.width === w ? 'on' : ''} onClick={() => setS((v) => ({ ...v, width: w }))}>
                    {w ? `${w}px` : 'Original'}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h5>Format</h5>
              <div className="chips">
                {FORMATS.map((f) => (
                  <button key={f.id} type="button" className={s.format === f.id ? 'on' : ''} onClick={() => setS((v) => ({ ...v, format: f.id }))}>
                    {f.id.toUpperCase()}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="ed-foot">
          <button type="button" className="ghost" onClick={() => setS(DEFAULT_SETTINGS)}>
            Reset all
          </button>
          <span className="ed-foot-right">
            <button type="button" className="ghost" onClick={() => onDownload(s)}>
              Download
            </button>
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => onApply(s)}>
              Apply
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
