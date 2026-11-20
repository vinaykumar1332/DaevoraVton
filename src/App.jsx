import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { Toast } from 'primereact/toast';
import { useAuth } from '@/auth/context/AuthContext.jsx';
import { useCredits } from '@/hooks/useCredits.js';
import { useWorkflowRun, firstPhoto } from '@/hooks/useWorkflowRun.js';
import { WORKFLOWS, NAV_GROUPS, NAV_IDS, findWorkflow, defaultValues, missingFields } from '@/workflows/engines.js';
import { friendlyError } from '@/lib/messages.js';
import PageLoader from '@/components/common/PageLoader.jsx';

const Workspace = lazy(() => import('@/features/workspace/Workspace.jsx'));
const ChatStudio = lazy(() => import('@/features/chat/ChatStudio.jsx'));
const BulkPanel = lazy(() => import('@/features/bulk/BulkPanel.jsx'));

/*
  App = shell (top bar + side nav) and routing between three kinds of screen:
    'ai-studio' -> ChatStudio   (chat with the styling assistant)
    'bulk'      -> BulkPanel    (models x garments grid)
    other ids   -> Workspace    (form workflows defined in workflows/engines.js)
  Run state lives in useWorkflowRun so it survives switching screens.
*/
export default function App() {
  const toast = useRef(null);
  const { user, logout } = useAuth();
  const [active, setActive] = useState('ai-studio');
  const [valuesById, setValuesById] = useState(() => Object.fromEntries(WORKFLOWS.map((w) => [w.id, defaultValues(w)])));

  const notifyError = useCallback((err) => {
    const f = friendlyError(err);
    toast.current?.show({ severity: 'error', summary: f.title, detail: f.detail, life: 7000 });
  }, []);
  const slotError = (msg) => toast.current?.show({ severity: 'warn', summary: 'Photo', detail: msg, life: 4000 });

  const { credits, loading: creditsLoading, refresh: refreshCredits } = useCredits(notifyError);
  const run = useWorkflowRun({ toast, notifyError, onSettled: refreshCredits });

  const wf = findWorkflow(active);
  const values = wf ? (valuesById[wf.id] ?? defaultValues(wf)) : {};
  const setValues = useCallback(
    (updater) =>
      setValuesById((all) => ({
        ...all,
        [active]: typeof updater === 'function' ? updater(all[active]) : updater,
      })),
    [active]
  );

  function restore(entry) {
    if (run.running) return;
    setActive(entry.wfId);
    setValuesById((all) => ({ ...all, [entry.wfId]: entry.values }));
    run.setResult(entry.result);
    run.setLastError(null);
  }

  const missing = wf ? missingFields(wf, values) : [];
  const perCredits = wf?.credits ? wf.credits(values) : null;
  const costLabel = !wf
    ? ''
    : perCredits != null
      ? `≈ ${perCredits} credit${perCredits === 1 ? '' : 's'}${wf.costNote ? ` · ${wf.costNote}` : ''}`
      : wf.costNote
        ? `Cost: ${wf.costNote}`
        : '';

  const shownResult = run.result && run.result.wfId === wf?.id ? run.result : null;

  return (
    <div className="shell">
      <Toast ref={toast} position="top-right" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M16 4c2 0 3 1.4 3 3 0 1.4-1 2.2-2.2 2.9L16 10.4 26.5 17c1.4.9 1.2 3-1.2 3H6.7c-2.4 0-2.6-2.1-1.2-3L16 10.4" />
            </svg>
          </span>
          <div>
            <h1>Fitting Room</h1>
            <small>Try any look on, before it exists</small>
          </div>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="credits"
            onClick={refreshCredits}
            disabled={creditsLoading}
            title={
              credits?.subscription != null
                ? `Subscription ${credits.subscription} · On-demand ${credits.onDemand ?? '-'}. Click to refresh.`
                : 'Click to refresh'
            }
          >
            <b>{creditsLoading ? '…' : (credits?.total ?? 'n/a')}</b> credits
          </button>
          <button type="button" className="credits user-chip" onClick={logout} title="Sign out">
            <i className="pi pi-user" /> {user?.name} <i className="pi pi-sign-out" />
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="Workflows">
          {NAV_GROUPS.map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-title">{g}</div>
              {WORKFLOWS.filter((w) => w.group === g && NAV_IDS.includes(w.id)).map((w) => (
                <button key={w.id} type="button" className={`nav-item ${active === w.id ? 'on' : ''}`} onClick={() => setActive(w.id)} title={w.short}>
                  <i className={w.icon} />
                  <span>{w.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="nav-group">
            <div className="nav-title">Batch</div>
            <button type="button" className={`nav-item ${active === 'bulk' ? 'on' : ''}`} onClick={() => setActive('bulk')}>
              <i className="pi pi-table" />
              <span>Bulk grid</span>
            </button>
          </div>
        </nav>

        <main className="content">
          <Suspense fallback={<PageLoader />}>
            <div className="page-enter" key={active}>
              {active === 'ai-studio' ? (
                <ChatStudio toast={toast} />
              ) : active === 'bulk' ? (
                <BulkPanel
                  onDone={(e) => run.addHistory({ id: `${Date.now()}-${Math.random()}`, time: new Date(), ...e })}
                  onRunsChanged={refreshCredits}
                />
              ) : wf ? (
                <Workspace
                  wf={wf}
                  values={values}
                  setValues={setValues}
                  running={run.running}
                  status={run.status}
                  elapsed={run.elapsed}
                  result={shownResult}
                  lastError={shownResult ? null : run.lastError}
                  history={run.history.filter((h) => h.wfId === wf.id)}
                  missing={missing}
                  costLabel={costLabel}
                  runPhoto={run.runPhoto}
                  beforePhoto={firstPhoto(wf, values)}
                  onGenerate={() => run.generate(wf, values)}
                  onCancel={run.cancel}
                  onRestore={restore}
                  onError={slotError}
                  toast={toast}
                />
              ) : null}
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
