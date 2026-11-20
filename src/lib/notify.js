import { toast } from 'sonner';

const KIND = { success: 'success', info: 'info', warn: 'warning', error: 'error' };

/**
 * Show a toast. `severity`: success | info | warn | error. `life` is in milliseconds.
 * Rendered by <Toaster /> (shadcn "sonner"), mounted once in App.
 */
export function notify({ severity = 'info', summary, detail, life = 4000 }) {
  toast[KIND[severity] ?? 'info'](summary, { description: detail, duration: life });
}
