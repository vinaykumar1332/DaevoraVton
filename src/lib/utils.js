/** Merge class names, filtering falsy values. */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/** Format a number as a compact string (1200 → 1.2k). */
export function formatCount(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Clamp a value between min and max. */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
