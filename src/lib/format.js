// Locale-aware number and date formatting. Uses the viewer's browser language, so a German
// or French user sees 1.234 / 1 234 and their own date order. Falls back to plain text if Intl fails.

/** Whole numbers with the viewer's grouping, e.g. 1234 → "1,234" (en) or "1.234" (de). */
export function formatNumber(n, options = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  try {
    return new Intl.NumberFormat(undefined, options).format(Number(n));
  } catch {
    return String(n);
  }
}

/** A calendar date in the viewer's own format, e.g. "22 Nov 2026" (en-GB) or "22.11.2026" (de). */
export function formatDay(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts));
  } catch {
    return new Date(ts).toDateString();
  }
}
