import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Full-screen image viewer: arrows / swipe-free keyboard nav, click to zoom, thumbnails. */
export default function Lightbox({ images, index, onIndex, onClose, onDownload }) {
  const [zoom, setZoom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const closeRef = useRef(null);
  const count = images.length;

  const go = useCallback(
    (d) => {
      setZoom(false);
      setLoaded(false);
      onIndex((index + d + count) % count);
    },
    [index, count, onIndex]
  );

  useEffect(() => {
    const prevFocus = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && count > 1) go(1);
      else if (e.key === 'ArrowLeft' && count > 1) go(-1);
      else if (e.key === '+' || e.key === 'z') setZoom((z) => !z);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, count]);

  const url = images[index];

  return createPortal(
    <div className="lb" role="dialog" aria-modal="true" aria-label="Image preview" onClick={onClose}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-count">
          {index + 1} of {count}
        </span>
        <div className="lb-tools">
          <button type="button" className="lb-btn" onClick={() => setZoom((z) => !z)}>
            {zoom ? 'Fit to screen' : 'Zoom in'}
          </button>
          {onDownload && (
            <button type="button" className="lb-btn" onClick={() => onDownload(url, index)}>
              Download
            </button>
          )}
          <button ref={closeRef} type="button" className="lb-btn lb-close" onClick={onClose} aria-label="Close preview">
            <i className="pi pi-times" />
          </button>
        </div>
      </div>

      <div className={`lb-stage ${zoom ? 'zoomed' : ''}`} onClick={(e) => e.stopPropagation()}>
        {count > 1 && (
          <button type="button" className="lb-nav prev" aria-label="Previous image" onClick={() => go(-1)}>
            <i className="pi pi-chevron-left" />
          </button>
        )}
        {!loaded && <div className="lb-skel shimmer" />}
        <img
          key={url}
          src={url}
          alt={`Result ${index + 1}`}
          className={loaded ? 'in' : ''}
          onLoad={() => setLoaded(true)}
          onClick={() => setZoom((z) => !z)}
        />
        {count > 1 && (
          <button type="button" className="lb-nav next" aria-label="Next image" onClick={() => go(1)}>
            <i className="pi pi-chevron-right" />
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
              onClick={() => {
                setZoom(false);
                setLoaded(false);
                onIndex(i);
              }}
            >
              <img src={u} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
