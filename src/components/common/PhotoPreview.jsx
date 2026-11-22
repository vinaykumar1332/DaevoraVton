import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * One shared preview for any photo: large image plus the tags we know about it.
 * `tags` is a list of short strings, e.g. ['garment', 'navy blue', 'front'].
 */
export default function PhotoPreview({ src, alt = 'Photo', tags = [], onClose, roleValue, roleOptions = [], onRoleChange, warnings = [] }) {
  const closeRef = useRef(null);

  useEffect(() => {
    const prev = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  if (!src) return null;
  return createPortal(
    <div className="pp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pp" role="dialog" aria-modal="true" aria-label={alt}>
        <button ref={closeRef} type="button" className="pp-close" onClick={onClose} aria-label="Close preview">
          <X aria-hidden="true" />
        </button>
        <div className="pp-image">
          <img src={src} alt={alt} />
        </div>
        {onRoleChange && (
          <label className="pp-role">
            <span>Role</span>
            <select value={roleValue} onChange={(e) => onRoleChange(e.target.value)}>
              {roleOptions.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {warnings.length > 0 && (
          <ul className="pp-warnings" role="note">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {tags.length > 0 && (
          <ul className="pp-tags" aria-label="Photo details">
            {tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
