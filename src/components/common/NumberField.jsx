import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { clamp } from '@/lib/utils.js';

/** Number input with - / + buttons. Empty input falls back to `fallback`; values are clamped to min/max. */
export default function NumberField({ value, onChange, min, max, step = 1, fallback, disabled, id }) {
  const lo = min ?? -Infinity;
  const hi = max ?? Infinity;
  const set = (n) => onChange(Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : fallback);

  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="outline" size="icon" aria-label="Decrease" disabled={disabled || (value ?? 0) <= lo} onClick={() => set((value ?? 0) - step)}>
        <Minus />
      </Button>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => set(e.target.value === '' ? NaN : Number(e.target.value))}
      />
      <Button type="button" variant="outline" size="icon" aria-label="Increase" disabled={disabled || (value ?? 0) >= hi} onClick={() => set((value ?? 0) + step)}>
        <Plus />
      </Button>
    </div>
  );
}
