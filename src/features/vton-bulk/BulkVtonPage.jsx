import { useCallback, useEffect, useState } from 'react';
import { fetchBatch, regenerateJob, bulkServerReady } from '@/api/bulk.js';
import { saveBatch, saveJobs, listBatches, forgetBatch } from '@/lib/bulkStore.js';
import { Dashboard, isActive } from './BulkViews.jsx';
import { MappingStep } from './MappingStep.jsx';
import { UploadStep, Stepper } from './UploadStep.jsx';
import './vton-bulk.css';

/**
 * Bulk VTON screen. Separate from AI Studio: its own state, its own browser database (bulk_batches,
 * bulk_jobs in "vton-bulk"), and its own API. The server copy of a batch is the source of truth;
 * the browser keeps a record so the history survives a refresh.
 */
export default function BulkVtonPage() {
  const [batch, setBatch] = useState(null);
  const [recent, setRecent] = useState([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [serverReady, setServerReady] = useState(null);

  useEffect(() => {
    bulkServerReady().then(setServerReady);
  }, []);

  const showError = useCallback((e) => setNotice({ tone: 'error', text: e.message || 'Something went wrong.' }), []);

  const remember = useCallback(async (data) => {
    const saved = await saveBatch(data);
    const jobs = await saveJobs(data.id, data.jobs);
    if (!saved.ok || !jobs.ok) {
      setNotice({ tone: 'warn', text: saved.quota || jobs.quota ? 'This browser is out of storage, so the history is not saved. Results still appear here.' : 'The history could not be saved in this browser.' });
    }
    setRecent(await listBatches());
  }, []);

  const open = useCallback(
    async (id, { quiet = false } = {}) => {
      try {
        const data = await fetchBatch(id);
        setBatch(data);
        await remember(data);
      } catch (e) {
        if (e.status === 404) {
          await forgetBatch(id);
          setRecent(await listBatches());
          setBatch(null);
          if (!quiet) setNotice({ tone: 'warn', text: 'That batch is no longer on the server.' });
        } else if (!quiet) showError(e);
      }
    },
    [remember, showError]
  );

  // On load: resume the most recent batch. Its progress is read from the server, so jobs keep their state.
  useEffect(() => {
    (async () => {
      const list = await listBatches();
      setRecent(list);
      if (list[0]) await open(list[0].id, { quiet: true });
    })();
  }, [open]);

  // While jobs run, refresh the batch every 2 seconds. Stops when nothing is queued or running.
  const active = isActive(batch);
  useEffect(() => {
    if (!active || !batch) return undefined;
    const t = setInterval(() => open(batch.id, { quiet: true }), 2000);
    return () => clearInterval(t);
  }, [active, batch?.id, open]);

  async function regenerate(job, instruction) {
    setBusy(true);
    try {
      const data = await regenerateJob(batch.id, job.id, instruction);
      setBatch(data);
      await remember(data);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  const step = creating || !batch ? 'upload' : batch.jobs.length ? 'dashboard' : 'mapping';
  const stepperKey = step === 'dashboard' ? 'generate' : step === 'mapping' ? 'map' : 'upload';

  return (
    <div className="vb">
      <header className="vb-head">
        <div>
          <h1>Bulk try-on</h1>
          <p className="muted">Upload a ZIP of photos and a mapping sheet, then generate every look in one batch.</p>
        </div>
        <div className="vb-head-actions">
          {batch && !creating && (
            <button type="button" className="vb-link" onClick={() => setCreating(true)}>
              New batch
            </button>
          )}
        </div>
      </header>

      {recent.length > 0 && (
        <nav className="vb-recent" aria-label="Recent batches">
          {recent.slice(0, 8).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`vb-chip ${batch?.id === r.id ? 'on' : ''}`}
              onClick={() => {
                setCreating(false);
                open(r.id);
              }}
            >
              {r.name}
              {r.summary ? ` · ${r.summary.completed}/${r.summary.total}` : ''}
            </button>
          ))}
        </nav>
      )}

      {serverReady === false && (
        <p className="vb-notice is-error" role="alert">
          The bulk server is not reachable from this page. Set BACKEND_PORT in .env to a free port (for example 3055), run npm run dev:full, then reload.
        </p>
      )}

      {notice && (
        <p className={`vb-notice ${notice.tone === 'error' ? 'is-error' : ''}`} role="alert">
          {notice.text}{' '}
          <button type="button" className="vb-link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <Stepper current={stepperKey} />

      {step === 'upload' && (
        <UploadStep
          serverReady={serverReady}
          onError={showError}
          onCreated={async (data) => {
            setCreating(false);
            setBatch(data);
            setNotice(null);
            await remember(data);
          }}
        />
      )}
      {step === 'mapping' && (
        <MappingStep
          batch={batch}
          onBatch={async (data) => {
            setBatch(data);
            await remember(data);
          }}
          onError={showError}
          onStarted={async (data) => {
            setBatch(data);
            setNotice(null);
            await remember(data);
          }}
        />
      )}
      {step === 'dashboard' && <Dashboard batch={batch} onRegenerate={regenerate} busy={busy} />}
    </div>
  );
}
