import { useEffect, useState } from 'react';

const STAGES = [
  { at: 0, text: 'Reading your photos' },
  { at: 6, text: 'Pinning the garment' },
  { at: 14, text: 'Stitching the fit' },
  { at: 26, text: 'Pressing the folds' },
  { at: 40, text: 'Final touches' },
];

/**
 * Loading state for a running job: the user's own photo sits behind a stitched frame
 * while a scan line moves over it, so the wait feels like a fitting, not a spinner.
 */
export default function FittingLoader({ image, status, elapsed, onCancel }) {
  const stageIndex = STAGES.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);
  const [shown, setShown] = useState(stageIndex);

  // Only ever move forward so the checklist never flickers back.
  useEffect(() => setShown((s) => Math.max(s, stageIndex)), [stageIndex]);

  return (
    <div className="fit" role="status" aria-live="polite">
      <div className="fit-frame">
        {image ? <img className="fit-photo" src={image} alt="" /> : <div className="fit-photo fit-blank" />}
        <div className="fit-scan" aria-hidden="true" />
        <svg className="fit-stitch" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden="true">
          <rect x="2" y="2" width="96" height="121" rx="4" pathLength="100" />
        </svg>
        <div className="fit-time">{elapsed}s</div>
      </div>

      <div className="fit-info">
        <p className="fit-status">{status || 'Working…'}</p>
        <ol className="fit-stages">
          {STAGES.map((s, i) => (
            <li key={s.text} className={i < shown ? 'done' : i === shown ? 'now' : ''}>
              <span className="fit-dot" aria-hidden="true" />
              {s.text}
            </li>
          ))}
        </ol>
        {onCancel && (
          <button type="button" className="link-btn" onClick={onCancel}>
            Stop waiting
          </button>
        )}
      </div>
    </div>
  );
}
