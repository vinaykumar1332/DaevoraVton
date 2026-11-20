import { useEffect, useState } from 'react';

/**
 * useState that is remembered in this browser (localStorage), for small per-viewer preferences
 * such as "sidebar collapsed". Works (without remembering) when storage is blocked.
 */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked or full: keep the in-memory value */
    }
  }, [key, value]);
  return [value, setValue];
}
