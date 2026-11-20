import ImageSlot from '@/components/common/ImageSlot.jsx';

/**
 * One garment with a front photo and an optional back photo.
 * Pure UI: the parent owns the two values (front / back are separate fields).
 *
 *   <GarmentSlot label="Top" hint="Shirt, jacket" front={v.top} back={v.topBack}
 *                onFront={...} onBack={...} onError={...} />
 */
export default function GarmentSlot({ label, hint, front, back, onFront, onBack, onError, required = false, disabled = false }) {
  const backOnly = !!back && !front;
  const both = !!front && !!back;

  return (
    <div className={`garment ${backOnly ? 'needs-front' : ''}`}>
      <div className="slot-label">
        <span>
          {label}
          {required && <span className="required" aria-label="required"> *</span>}
          {!required && <span className="opt-badge">Optional</span>}
        </span>
        {hint && <small>{hint}</small>}
      </div>

      <div className="garment-views">
        <ImageSlot
          mini
          compact
          badge={false}
          required={false}
          label="Front"
          value={front}
          disabled={disabled}
          onChange={onFront}
          onError={onError}
        />
        <ImageSlot
          mini
          compact
          badge={false}
          label="Back"
          value={back}
          disabled={disabled}
          onChange={onBack}
          onError={onError}
        />
      </div>

      {backOnly && (
        <small className="garment-warn" role="alert">
          Add the front photo too. A back photo alone is not enough.
        </small>
      )}
      {both && (
        <button
          type="button"
          className="link-btn garment-swap"
          disabled={disabled}
          onClick={() => {
            onFront(back);
            onBack(front);
          }}
        >
          <i className="pi pi-arrow-right-arrow-left" aria-hidden="true" /> Swap front and back
        </button>
      )}
    </div>
  );
}
