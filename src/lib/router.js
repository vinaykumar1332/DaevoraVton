// Tiny history-based router: one URL path per feature, plus optional query params.
//   /ai-studio   /outfit-studio?workflow=indian   /upscale   /background-remove   /bulk
// No dependency: the app has a handful of flat routes. Dev and preview servers already fall back
// to index.html for unknown paths. A static host needs the same "all paths -> index.html" rule.
import { useCallback, useEffect, useState } from 'react';

export const DEFAULT_ROUTE = 'ai-studio';

/** Route id for a pathname, or null when it is not a known page. */
export function idFromPath(pathname, validIds) {
  const id = pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  return validIds.includes(id) ? id : null;
}

export function pathFor(id, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return `/${id}${q ? `?${q}` : ''}`;
}

const readLocation = () => ({ pathname: window.location.pathname, search: window.location.search });

/**
 * Returns { active, params, navigate }.
 *   navigate(id, params?, { replace }?)  changes the page without a reload.
 * An unknown path (including "/") is replaced by the default page.
 */
export function useRoute(validIds) {
  const [loc, setLoc] = useState(readLocation);

  useEffect(() => {
    const onPop = () => setLoc(readLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const found = idFromPath(loc.pathname, validIds);
  useEffect(() => {
    if (!found) {
      window.history.replaceState(null, '', pathFor(DEFAULT_ROUTE));
      setLoc(readLocation());
    }
  }, [found]);

  const navigate = useCallback((id, params = {}, { replace = false } = {}) => {
    const url = pathFor(id, params);
    if (url === window.location.pathname + window.location.search) return;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    setLoc(readLocation());
  }, []);

  return { active: found ?? DEFAULT_ROUTE, params: Object.fromEntries(new URLSearchParams(loc.search)), navigate };
}
