import { useEffect, useRef, useState } from 'react';
import Lightbox from '@/components/common/Lightbox.jsx';
import { ACCEPT, checkUrl, pickImageFile, prepareFile, urlValue } from '@/lib/imageIntake.js';

/**
 * One photo slot: drag in, click, paste, or use a link.
 *
 * value:    null | { src, kind: 'file' | 'url', name, info?, warning? }
 * onChange: (value | null) => void
 * onError:  (message: string) => void   user-facing problem (bad file, bad link, ignored extras)
 *
 * Props: required / compact / mini (small tile inside a GarmentSlot) / disabled (e.g. while a run is active)
 *        badge=false hides the "Optional" badge when the parent already shows it.
 */
export default function ImageSlot({
  label,
  hint,
  value,
  onChange,
  onError,
  required = false,
  compact = false,
  mini = false,
  disabled = false,
  badge = true,
}) {
  const inputRef = useRef(null);
  const dragDepth = useRef(0);
  const opId = useRef(0); // newest upload wins if the user replaces a photo while one is still processing
  const mounted = useRef(true);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A new image (or none) starts from a clean display state.
  const src = value?.src ?? null;
  useEffect(() => {
    setLoaded(false);
    setBroken(false);
    if (!src) setZoom(false);
  }, [src]);

  const inert = disabled || busy;

  async function handleFiles(files) {
    if (disabled) return;
    const { file, extra, nonImages } = pickImageFile(files);
    if (!file) {
      if (nonImages) onError?.('That is not an image. Use a JPEG, PNG or WebP photo.');
      return;
    }
    const id = ++opId.current;
    setBusy(true);
    try {
      const v = await prepareFile(file);
      if (!mounted.current || id !== opId.current) return; // replaced or removed meanwhile
      onChange(v);
      if (extra) onError?.(`Only the first photo was used. ${extra} other photo(s) were ignored.`);
    } catch (e) {
      if (mounted.current && id === opId.current) onError?.(e.message);
    } finally {
      if (mounted.current && id === opId.current) setBusy(false);
    }
  }

  function applyUrl() {
    const problem = checkUrl(url);
    if (problem) {
      onError?.(problem);
      return;
    }
    opId.current++;
    onChange(urlValue(url));
    setUrl('');
    setShowUrl(false);
  }

  function onDrop(e) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (inert) return;
    if (e.dataTransfer.files?.length) return handleFiles(e.dataTransfer.files);
    const dropped = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (!dropped) return;
    const problem = checkUrl(dropped);
    if (problem) onError?.(problem);
    else {
      opId.current++;
      onChange(urlValue(dropped));
    }
  }

  function onPaste(e) {
    if (inert) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  const pick = () => !inert && inputRef.current?.click();
  const remove = () => {
    opId.current++;
    setBusy(false);
    onChange(null);
  };

  return (
    <div className={`slot ${compact ? 'compact' : ''} ${mini ? 'mini' : ''}`}>
      <div className="slot-label">
        <span>
          {label}
          {required && <span className="required" aria-label="required"> *</span>}
          {!required && badge && <span className="opt-badge">Optional</span>}
        </span>
        {hint && <small>{hint}</small>}
      </div>

      <div
        className={`drop ${dragging ? 'dragging' : ''} ${value ? 'filled' : ''} ${disabled ? 'disabled' : ''}`}
        tabIndex={disabled ? -1 : 0}
        role={value ? 'group' : 'button'}
        aria-disabled={disabled || undefined}
        aria-busy={busy || undefined}
        aria-label={value ? `${label} photo` : `Upload ${label}`}
        onClick={() => !value && pick()}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (!value && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            pick();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          if (!inert) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {busy ? (
          <div className="drop-busy shimmer" role="status">
            <span>Preparing photo…</span>
          </div>
        ) : value ? (
          <>
            {broken ? (
              <div className="drop-broken" role="alert">
                <i className="pi pi-exclamation-triangle" aria-hidden="true" />
                <b>Could not load this image</b>
                <span>The link may be private, expired or not an image.</span>
              </div>
            ) : (
              <button
                type="button"
                className={`drop-preview ${loaded ? '' : 'shimmer'}`}
                onClick={() => setZoom(true)}
                aria-label={`Preview ${label}`}
              >
                <img
                  src={value.src}
                  alt={label}
                  onLoad={() => setLoaded(true)}
                  onError={() => {
                    setBroken(true);
                    onError?.(`Could not load the image for ${label}. Check the link or upload the file.`);
                  }}
                  className={loaded ? 'in' : ''}
                />
              </button>
            )}
            <div className="drop-actions">
              <button type="button" onClick={pick} disabled={disabled}>
                Replace
              </button>
              <button type="button" onClick={remove} disabled={disabled}>
                Remove
              </button>
            </div>
          </>
        ) : (
          <div className="drop-empty">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <rect x="6" y="6" width="36" height="36" rx="6" />
              <path d="M6 34l10-10 8 8 6-6 12 12" />
              <circle cx="31" cy="17" r="3" />
            </svg>
            <b>{dragging ? 'Drop to upload' : mini ? 'Add' : 'Add photo'}</b>
            <span>Drag in, click, or paste</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = ''; // lets the same file be chosen again after Remove
          }}
        />
      </div>

      {value && (value.warning || value.info) && (
        <small className={`slot-info ${value.warning ? 'warn' : ''}`} title={value.name}>
          {value.warning || value.info}
        </small>
      )}

      {!value &&
        !disabled &&
        (showUrl ? (
          <div className="slot-url">
            <input
              autoFocus
              type="url"
              placeholder="https://…"
              value={url}
              aria-label={`${label} image link`}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyUrl();
                if (e.key === 'Escape') setShowUrl(false);
              }}
            />
            <button type="button" onClick={applyUrl} disabled={!url.trim()}>
              Use
            </button>
          </div>
        ) : (
          <button type="button" className="link-btn slot-link" onClick={() => setShowUrl(true)}>
            {mini ? 'Use a link' : 'Use an image link instead'}
          </button>
        ))}

      {zoom && value && !broken && <Lightbox images={[value.src]} index={0} onIndex={() => {}} onClose={() => setZoom(false)} />}
    </div>
  );
}
