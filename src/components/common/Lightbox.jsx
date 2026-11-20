import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Maximize, Minimize, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SWIPE_PX = 50;

/**
 * Full-screen image viewer: keyboard and swipe navigation, zoom, full-screen mode,
 * download / open / copy link, image size, focus kept inside the dialog.
 */
export default function Lightbox({ images, index, onIndex, onClose, onDownload, label = 'Image preview' }) {
  const [zoom, setZoom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [size, setSize] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const touchX = useRef(null);
  const count = images.length;
  const url = images[index];
  const isWeb = /^https?:/.test(url);

  const go = useCallback(
    (d) => {
      setZoom(false);
      setLoaded(false);
      setSize(null);
      onIndex((index + d + count) % count);
    },
    [index, count, onIndex]
  );

  useEffect(() => {
    const prevFocus = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      prevFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (!document.fullscreenElement) onClose();
      } else if (e.key === 'ArrowRight' && count > 1) go(1);
      else if (e.key === 'ArrowLeft' && count > 1) go(-1);
      else if (e.key === '+' || e.key === '=' || e.key.toLowerCase() === 'z') setZoom((z) => !z);
      else if (e.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), a[href]')];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, count]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else dialogRef.current?.requestFullscreen?.().catch(() => {});
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return createPortal(
    <div ref={dialogRef} className="lb" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <div className="lb-info">
          <span className="lb-count">
            {index + 1} / {count}
          </span>
          {size && <span className="lb-size">{size}</span>}
        </div>
        <div className="lb-tools">
          <button type="button" className="lb-btn" onClick={() => setZoom((z) => !z)} aria-pressed={zoom} title="Zoom (Z)">
            <Search className="size-4" aria-hidden="true" />
            <span>{zoom ? 'Fit' : 'Zoom'}</span>
          </button>
          <button type="button" className="lb-btn lb-icon-only" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen">
            {fullscreen ? <Minimize className="size-4" aria-hidden="true" /> : <Maximize className="size-4" aria-hidden="true" />}
          </button>
          {isWeb && (
            <button type="button" className="lb-btn lb-icon-only" onClick={copyLink} aria-label="Copy image link" title="Copy image link">
              <Copy className="size-4" aria-hidden="true" />
              {copied && <span className="lb-toast">Copied</span>}
            </button>
          )}
          <a className="lb-btn lb-icon-only" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open image in new tab" title="Open in new tab">
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
          {onDownload && (
            <button type="button" className="lb-btn" onClick={() => onDownload(url, index)} title="Download">
              <Download className="size-4" aria-hidden="true" />
              <span>Download</span>
            </button>
          )}
          <button ref={closeRef} type="button" className="lb-btn lb-close" onClick={onClose} aria-label="Close preview" title="Close (Esc)">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className={`lb-stage ${zoom ? 'zoomed' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current == null || count < 2 || zoom) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > SWIPE_PX) go(dx < 0 ? 1 : -1);
        }}
      >
        {count > 1 && (
          <button type="button" className="lb-nav prev" aria-label="Previous image" onClick={() => go(-1)}>
            <ChevronLeft className="size-6" aria-hidden="true" />
          </button>
        )}
        {!loaded && <div className="lb-skel shimmer" />}
        <img
          key={url}
          src={url}
          alt={`${label} ${index + 1}`}
          className={loaded ? 'in' : ''}
          onLoad={(e) => {
            setLoaded(true);
            setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`);
          }}
          onClick={() => setZoom((z) => !z)}
          draggable={false}
        />
        {count > 1 && (
          <button type="button" className="lb-nav next" aria-label="Next image" onClick={() => go(1)}>
            <ChevronRight className="size-6" aria-hidden="true" />
          </button>
        )}
      </div>

      {count > 1 && (
        <div className="lb-thumbs" onClick={(e) => e.stopPropagation()}>
          {images.map((u, i) => (
            <button
              key={u + i}
              type="button"
              className={i === index ? 'on' : ''}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => {
                setZoom(false);
                setLoaded(false);
                setSize(null);
                onIndex(i);
              }}
            >
              <img src={u} alt="" />
            </button>
          ))}
        </div>
      )}

      <p className="lb-hint" aria-hidden="true" onClick={(e) => e.stopPropagation()}>
        {count > 1 && <span>← → browse</span>}
        <span>Z zoom</span>
        <span>Esc close</span>
      </p>
    </div>,
    document.body
  );
}
