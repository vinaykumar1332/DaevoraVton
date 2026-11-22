import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useRoute } from '@/lib/router.js';
// Chat state sits above the routes, so a running chat job continues while other pages are open.
import { ChatProvider } from '@/features/chat/ChatProvider.jsx';
import { OUTFIT_MODES } from '@/workflows/outfitModes.js';
import { LogOut, Menu, PanelLeft, Sparkles, X } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery.js';
import { useStoredState } from '@/hooks/useStoredState.js';
import { WfIcon } from '@/lib/icons.jsx';
import { Toaster } from '@/components/ui/sonner.jsx';
import { notify } from '@/lib/notify.js';
import { useAuth } from '@/auth/context/AuthContext.jsx';
import { useCredits } from '@/hooks/useCredits.js';
import { useWorkflowRun, firstPhoto } from '@/hooks/useWorkflowRun.js';
import { WORKFLOWS, NAV_GROUPS, NAV_IDS, findWorkflow, defaultValues, missingFields } from '@/workflows/engines.js';
import { friendlyError } from '@/lib/messages.js';
import PageLoader from '@/components/common/PageLoader.jsx';
import ErrorBoundary from '@/components/common/ErrorBoundary.jsx';

// Pages that are live in the UI. The others are hidden and their URLs fall back to AI Studio.
// Their code stays in place: add an id here to bring a page back.
const LIVE_PAGES = ['ai-studio'];
const ROUTE_IDS = LIVE_PAGES;

// Sidebar: AI Studio only, for now.
const NAV = [{ g: 'AI', items: [{ id: 'ai-studio', label: 'AI Studio', hint: 'Chat with the styling assistant', icon: <Sparkles aria-hidden="true" /> }] }];

const Workspace = lazy(() => import('@/features/workspace/Workspace.jsx'));
const ChatStudio = lazy(() => import('@/features/chat/ChatStudio.jsx'));

/*
  App = shell (top bar + side nav) and routing between three kinds of screen:
    'ai-studio' -> ChatStudio   (chat with the styling assistant)
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

  // Sidebar: on desktop it collapses to an icon rail (remembered); on phones it is a slide-in drawer.
  const isMobile = useMediaQuery('(max-width: 900px)');
  const [collapsed, setCollapsed] = useStoredState('fr.sidebarCollapsed', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const railCollapsed = collapsed && !isMobile;
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
  const toggleNav = useCallback(() => (isMobile ? setDrawerOpen((o) => !o) : setCollapsed((c) => !c)), [isMobile, setCollapsed]);
  const go = (id) => {
    navigate(id);
    setDrawerOpen(false);
  };
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleNav();
      } else if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleNav]);

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
    const title = 'AI Studio';
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
    <ChatProvider onJobSettled={refreshCredits}>
    <div className="shell">
      <Toaster position="top-right" richColors closeButton />

      {/* Mobile header — hamburger only, no topbar on desktop */}
      {isMobile && (
        <header className="topbar-mobile">
          <button type="button" className="nav-toggle" onClick={toggleNav} aria-controls="app-nav" aria-expanded={drawerOpen} aria-label={drawerOpen ? 'Close menu' : 'Open menu'}>
            <Menu />
          </button>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M16 4c2 0 3 1.4 3 3 0 1.4-1 2.2-2.2 2.9L16 10.4 26.5 17c1.4.9 1.2 3-1.2 3H6.7c-2.4 0-2.6-2.1-1.2-3L16 10.4" /></svg>
          </span>
          <span className="topbar-mobile-title">Fitting Room</span>
          <button type="button" className="credit-chip" onClick={refreshCredits} disabled={creditsLoading} aria-label={`${credits?.total ?? 'Unknown'} credits. Refresh balance`} title="Credits left. Tap to refresh">
            <b>{creditsLoading ? '…' : (credits?.total ?? 'n/a')}</b> <span>credits</span>
          </button>
        </header>
      )}

      <div className={`body ${railCollapsed ? 'sb-collapsed' : ''}`}>
        <nav id="app-nav" className="sidebar" aria-label="Workflows" data-collapsed={railCollapsed} data-open={isMobile && drawerOpen}>
          {isMobile && (
            <div className="sb-drawer-head">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32"><path d="M16 4c2 0 3 1.4 3 3 0 1.4-1 2.2-2.2 2.9L16 10.4 26.5 17c1.4.9 1.2 3-1.2 3H6.7c-2.4 0-2.6-2.1-1.2-3L16 10.4" /></svg>
              </span>
              <strong>Fitting Room</strong>
              <button type="button" className="sb-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                <X aria-hidden="true" />
              </button>
            </div>
          )}

          {!isMobile && (
            <div className="sb-head">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32"><path d="M16 4c2 0 3 1.4 3 3 0 1.4-1 2.2-2.2 2.9L16 10.4 26.5 17c1.4.9 1.2 3-1.2 3H6.7c-2.4 0-2.6-2.1-1.2-3L16 10.4" /></svg>
              </span>
              <div className="sb-brand-text">
                <strong>Fitting Room</strong>
                <small>Try any look on</small>
              </div>
              <button
                type="button"
                className="sb-toggle"
                onClick={toggleNav}
                aria-controls="app-nav"
                aria-expanded={!collapsed}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                data-tip={collapsed ? 'Expand (Ctrl+B)' : 'Collapse (Ctrl+B)'}
              >
                <PanelLeft aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Navigation groups */}
          {NAV.map(({ g, items }) => (
            <div className="nav-group" key={g}>
              <div className="nav-title"><span>{g}</span></div>
              {items.map((it) => {
                const live = LIVE_PAGES.includes(it.id);
                return (
                <button
                  key={it.id}
                  type="button"
                  className={`nav-item ${active === it.id ? 'on' : ''} ${live ? '' : 'soon'}`}
                  aria-current={active === it.id ? 'page' : undefined}
                  aria-disabled={live ? undefined : true}
                  disabled={!live}
                  data-tip={live ? it.label : `${it.label} · Coming soon`}
                  title={railCollapsed || !live ? undefined : it.hint}
                  onClick={() => live && go(it.id)}
                >
                  {it.icon}
                  <span className="nav-label">{it.label}</span>
                  {!live && <span className="nav-soon-tag">Soon</span>}
                </button>
                );
              })}
            </div>
          ))}

          {/* Spacer pushes footer to bottom */}
          <div className="sb-spacer" />

          {/* Credits + user at the bottom of the sidebar */}
          {(
            <div className="sb-footer">
              <div className="sb-account">
                <span className="sb-avatar" aria-hidden="true">{(user?.name ?? '?').trim().charAt(0).toUpperCase()}</span>
                <div className="sb-account-text">
                  <strong>{user?.name}</strong>
                  <button
                    type="button"
                    className="sb-credits"
                    onClick={refreshCredits}
                    disabled={creditsLoading}
                    title={
                      credits?.subscription != null
                        ? `Subscription ${credits.subscription} · On-demand ${credits.onDemand ?? '-'}. Click to refresh.`
                        : 'Click to refresh'
                    }
                  >
                    <b>{creditsLoading ? '…' : (credits?.total ?? 'n/a')}</b> <span className="sb-credit-word">credits</span>
                  </button>
                </div>
                <button type="button" className="sb-signout" onClick={logout} aria-label="Sign out" data-tip="Sign out">
                  <LogOut aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </nav>
        {isMobile && drawerOpen && <div className="nav-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

        <main className="content">
          <ErrorBoundary resetKey={active}>
          <Suspense fallback={<PageLoader />}>
            <div className="page-enter" key={active}>
              {active === 'ai-studio' ? (
                <ChatStudio onNavigate={go} />
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
          </ErrorBoundary>
        </main>
      </div>
    </div>
    </ChatProvider>
  );
}
