import { useRef, useState } from 'react';

/** Before / after slider. Drag, click, or use the arrow keys on the handle. */
export default function CompareSlider({ before, after, onOpen }) {
  const [pos, setPos] = useState(50);
  const ref = useRef(null);

  function fromPointer(e) {
    const r = ref.current.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  }

  return (
    <div
      ref={ref}
      className="cmp"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => e.buttons && fromPointer(e)}
    >
      <img className="cmp-img" src={after} alt="Result" draggable={false} />
      <img className="cmp-img cmp-before" src={before} alt="Original" draggable={false} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <span className="cmp-tag left">Original</span>
      <span className="cmp-tag right">Try-on</span>
      <div className="cmp-line" style={{ left: `${pos}%` }}>
        <button
          type="button"
          role="slider"
          aria-label="Compare original and result"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          className="cmp-handle"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 5));
            if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 5));
          }}
        >
          <i className="pi pi-arrows-h" />
        </button>
      </div>
      {onOpen && (
        <button type="button" className="cmp-open" onClick={onOpen} aria-label="Open full screen">
          <i className="pi pi-expand" />
        </button>
      )}
    </div>
  );
}
