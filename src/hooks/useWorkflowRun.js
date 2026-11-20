import { notify } from '@/lib/notify.js';
import { useCallback, useEffect, useRef, useState } from 'react';

/** First photo the user supplied, used behind the loader and as the "before" image. */
export function firstPhoto(wf, values) {
  if (!wf) return null;
  for (const f of wf.fields) {
    const v = values?.[f.key];
    if (f.type === 'image' && v?.src) return v.src;
    if (f.type === 'images' && v?.[0]?.src) return v[0].src;
  }
  return null;
}

/**
 * Owns the run lifecycle of a form workflow: status, elapsed time, result, error,
 * cancel and history. The caller supplies the error helper.
 */
export function useWorkflowRun({ notifyError, onSettled }) {
  const abortRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [runPhoto, setRunPhoto] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!running || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(t);
  }, [running, startedAt]);

  const generate = useCallback(
    async (wf, snapshot) => {
      if (!wf || abortRef.current) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setRunning(true);
      setResult(null);
      setLastError(null);
      setStartedAt(Date.now());
      setElapsed(0);
      setStatus('Sending your photos…');
      setRunPhoto(firstPhoto(wf, snapshot));

      try {
        const out = await wf.run(snapshot, { signal: ctrl.signal, onStatus: setStatus });
        const res = { label: wf.label, wfId: wf.id, ...out };
        setResult(res);
        setStatus(`Done — ${out.images.length} image(s)`);
        setHistory((h) => [{ id: `${Date.now()}`, time: new Date(), wfId: wf.id, values: snapshot, result: res }, ...h].slice(0, 100));
        notify({ severity: 'success', summary: 'Done', detail: `${out.images.length} image(s) ready`, life: 3000 });
      } catch (e) {
        if (ctrl.signal.aborted || e?.name === 'AbortError') {
          setStatus('Cancelled');
          notify({
            severity: 'info',
            summary: 'Cancelled',
            detail: 'Stopped waiting. A job already submitted may still finish and use credits.',
            life: 5000,
          });
        } else {
          setStatus('Failed');
          setLastError(e);
          notifyError(e);
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
        onSettled?.();
      }
    },
    [notifyError, onSettled]
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const addHistory = useCallback((entry) => setHistory((h) => [entry, ...h].slice(0, 100)), []);

  return { running, status, elapsed, result, setResult, lastError, setLastError, runPhoto, history, addHistory, generate, cancel };
}
