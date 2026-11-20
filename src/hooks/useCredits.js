import { useCallback, useEffect, useState } from 'react';
import { getCredits } from '@/api/fashn.js';

/** Loads the account's credit balance once and exposes a manual refresh. */
export function useCredits(onError) {
  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCredits(await getCredits());
    } catch (e) {
      setCredits(null);
      onError?.(e);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { credits, loading, refresh };
}
