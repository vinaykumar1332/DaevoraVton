import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useRoute } from '@/lib/router.js';
import { OUTFIT_MODES } from '@/workflows/outfitModes.js';
import { LogOut, Table2, User } from 'lucide-react';
import { WfIcon } from '@/lib/icons.jsx';
import { Toaster } from '@/components/ui/sonner.jsx';
import { notify } from '@/lib/notify.js';
import { useAuth } from '@/auth/context/AuthContext.jsx';
import { useCredits } from '@/hooks/useCredits.js';
import { useWorkflowRun, firstPhoto } from '@/hooks/useWorkflowRun.js';
import { WORKFLOWS, NAV_GROUPS, NAV_IDS, findWorkflow, defaultValues, missingFields } from '@/workflows/engines.js';
import { friendlyError } from '@/lib/messages.js';
import PageLoader from '@/components/common/PageLoader.jsx';

// Every page has its own URL path: /<id>. 'ai-studio' and the form workflows come from NAV_IDS.
const ROUTE_IDS = [...NAV_IDS, 'bulk'];

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
  const { user, logout } = useAuth();
  const { active, params, navigate } = useRoute(ROUTE_IDS);
  const [valuesById, setValuesById] = useState(() => Object.fromEntries(WORKFLOWS.map((w) => [w.id, defaultValues(w)])));

  const notifyError = useCallback((err) => {
    const f = friendlyError(err);
    notify({ severity: 'error', summary: f.title, detail: f.detail, life: 7000 });
  }, []);
  const slotError = (msg) => notify({ severity: 'warn', summary: 'Photo', detail: msg, life: 4000 });

  const { credits, loading: creditsLoading, refresh: refreshCredits } = useCredits(notifyError);
  const run = useWorkflowRun({ notifyError, onSettled: refreshCredits });

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

  // The URL decides the Outfit Studio workflow (?workflow=flat). With no valid param, the URL adopts the stored one.
  const urlMode = OUTFIT_MODES.some((m) => m.id === params.workflow) ? params.workflow : null;
  useEffect(() => {
    if (active !== 'outfit-studio') return;
    if (urlMode) setValues((cur) => (cur.mode === urlMode ? cur : { ...cur, mode: urlMode }));
    else navigate('outfit-studio', { workflow: values.mode || OUTFIT_MODES[0].id }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, urlMode]);

  useEffect(() => {
    const title = active === 'bulk' ? 'Bulk grid' : (wf?.label ?? 'AI Studio');
    document.title = `${title} · Fitting Room`;
  }, [active, wf]);

  function restore(entry) {
    if (run.running) return;
    navigate(entry.wfId, entry.wfId === 'outfit-studio' ? { workflow: entry.values?.mode } : {});
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
      <Toaster position="top-right" richColors closeButton />

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
            <User className="size-4" /> {user?.name} <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="Workflows">
          {NAV_GROUPS.map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-title">{g}</div>
              {WORKFLOWS.filter((w) => w.group === g && NAV_IDS.includes(w.id)).map((w) => (
                <button key={w.id} type="button" className={`nav-item ${active === w.id ? 'on' : ''}`} onClick={() => navigate(w.id)} title={w.short}>
                  <WfIcon name={w.icon} />
                  <span>{w.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="nav-group">
            <div className="nav-title">Batch</div>
            <button type="button" className={`nav-item ${active === 'bulk' ? 'on' : ''}`} onClick={() => navigate('bulk')}>
              <Table2 />
              <span>Bulk grid</span>
            </button>
          </div>
        </nav>

        <main className="content">
          <Suspense fallback={<PageLoader />}>
            <div className="page-enter" key={active}>
              {active === 'ai-studio' ? (
                <ChatStudio />
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
                  onModeChange={(id) => navigate('outfit-studio', { workflow: id })}
                  onError={slotError}
                />
              ) : null}
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
