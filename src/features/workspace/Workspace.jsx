import './workspace.css';
import { useEffect, useRef } from 'react';
import { Message } from 'primereact/message';
import { FieldInput, TileGrid } from '@/features/workspace/WorkflowForm.jsx';
import ResultsGallery from '@/features/gallery/ResultsGallery.jsx';
import FittingLoader from '@/components/common/FittingLoader.jsx';
import { friendlyError } from '@/lib/messages.js';

/*
  Workspace: the screen for every form-based workflow (Try-On Max, Upscale, Remove background, …).

  Layout
    header      title + progress steps
    left card   1. photos (large tiles)  2. instruction (optional)  Settings (collapsed)
    right card  result canvas (sticky on wide screens) + recent results strip
    bottom bar  cost · what is missing · Cancel / Generate

  Fields come from the workflow definition in engines.js, sorted by type:
    image / images -> photos,  text -> instruction,  select / number -> settings.
  So a new workflow only needs a definition there; no layout code.
*/

const isPhoto = (f) => f.type === 'image' || f.type === 'images';
const isSetting = (f) => f.type === 'select' || f.type === 'number';

function filled(f, v) {
  if (f.type === 'image') return !!v;
  if (f.type === 'images') return (v || []).length > 0;
  if (f.type === 'text') return !!String(v ?? '').trim();
  return v != null && v !== '';
}

function settingText(f, v) {
  if (f.type === 'select') return f.options.find((o) => o.value === v)?.label ?? v;
  return `${f.label} ${v}`;
}

const STEPS = [
  { label: 'Add photos' },
  { label: 'Adjust', optional: true },
  { label: 'Generate' },
  { label: 'Review' },
];

export default function Workspace({
  wf,
  values,
  setValues,
  running,
  status,
  elapsed,
  result,
  lastError,
  history,
  missing,
  costLabel,
  runPhoto,
  beforePhoto,
  onGenerate,
  onCancel,
  onRestore,
  onModeChange,
  onError,
  toast,
}) {
  const visible = wf.fields.filter((f) => !f.hidden && (!f.showIf || f.showIf(values)));
  const photos = visible.filter(isPhoto);
  const details = visible.filter((f) => f.type === 'text');
  const styleFields = visible.filter((f) => f.primary && isSetting(f));
  const settings = visible.filter((f) => isSetting(f) && !f.primary);
  const mode = wf.modes?.find((m) => m.id === values.mode) ?? wf.modes?.[0];

  const resultRef = useRef(null);
  const hasOutput = running || !!lastError || !!result || history.length > 0;
  useEffect(() => {
    if (running || result) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [running, result]);

  const photosReady =
    photos.some((f) => filled(f, values[f.key])) && photos.filter((f) => f.required).every((f) => filled(f, values[f.key]));
  const stage = running ? 2 : result ? 3 : photosReady ? 2 : 0;
  const setField = (key, val) => setValues((cur) => ({ ...cur, [key]: val }));
  let n = 0;

  return (
    <div className="ws">
      <header className="ws-head">
        <div className="ws-title">
          <h2>{wf.label}</h2>
          <p>{mode?.blurb ?? wf.blurb}</p>
        </div>
        <ol className="ws-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.label} className={i < stage ? 'done' : i === stage ? 'now' : ''} aria-current={i === stage ? 'step' : undefined}>
              <i>{i < stage ? '✓' : i + 1}</i>
              {s.label}
              {s.optional && <small>optional</small>}
            </li>
          ))}
        </ol>
      </header>

      <div className={`ws-layout ${wf.modes ? 'has-rail' : ''}`}>
        {wf.modes && (
          <nav className="ws-rail" aria-label={`${wf.label} workflows`}>
            <div className="ws-rail-title">Workflow</div>
            {wf.modes.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`ws-mode ${mode?.id === m.id ? 'on' : ''}`}
                aria-pressed={mode?.id === m.id}
                disabled={running}
                onClick={() => (onModeChange ? onModeChange(m.id) : setField('mode', m.id))}
              >
                <i className={m.icon} aria-hidden="true" />
                <span>
                  <b>{m.label}</b>
                  <small>{m.short}</small>
                </span>
              </button>
            ))}
          </nav>
        )}

        <div className="ws-main">
        <section className="ws-card ws-inputs" aria-label="Inputs">
          {photos.length > 0 && (
            <div className="ws-sec">
              <div className="ws-sec-head">
                <span className="ws-n">{++n}</span>
                <h3>Add photos</h3>
                {photosReady && <span className="ws-ok">✓ Ready</span>}
              </div>
              <TileGrid fields={photos} values={values} setValues={setValues} onError={onError} disabled={running} maxPhotos={wf.maxPhotos} />
            </div>
          )}

          {styleFields.length > 0 && (
            <div className="ws-sec">
              <div className="ws-sec-head">
                <span className="ws-n">{++n}</span>
                <h3>Style</h3>
              </div>
              <div className="ws-style-grid">
                {styleFields.map((f) => (
                  <FieldInput key={f.key} f={f} value={values[f.key]} disabled={running} onChange={(v) => setField(f.key, v)} />
                ))}
              </div>
            </div>
          )}

          {details.length > 0 && (
            <div className="ws-sec">
              <div className="ws-sec-head">
                <span className="ws-n">{++n}</span>
                <h3>Adjust</h3>
                {!details.some((f) => f.required) && <span className="ws-opt">Optional</span>}
              </div>
              {details.map((f) => (
                <FieldInput key={f.key} f={f} value={values[f.key]} disabled={running} onChange={(v) => setField(f.key, v)} />
              ))}
            </div>
          )}

          {settings.length > 0 && (
            <details className="ws-adv">
              <summary>
                <span>Settings</span>
                <small>{settings.map((f) => settingText(f, values[f.key])).join(' · ')}</small>
              </summary>
              <div className="ws-adv-grid">
                {settings.map((f) => (
                  <FieldInput key={f.key} f={f} value={values[f.key]} disabled={running} onChange={(v) => setField(f.key, v)} />
                ))}
              </div>
            </details>
          )}
        </section>

        {hasOutput && (
          <section className="ws-card ws-result" aria-label="Result" ref={resultRef}>
            <div className="ws-result-head">
              <h3>Result</h3>
              {result?.credits != null && !running && <span className="chip">{result.credits} credits used</span>}
            </div>

            {(running || lastError || result) && (
              <div className="ws-canvas">
                {running ? (
                  <FittingLoader image={runPhoto} status={status} elapsed={elapsed} onCancel={onCancel} />
                ) : lastError ? (
                  <Message severity="error" className="w-full" text={`${friendlyError(lastError).title}. ${friendlyError(lastError).detail}`} />
                ) : (
                  <ResultsGallery result={result} toast={toast} before={beforePhoto} />
                )}
              </div>
            )}

            {result && !running && <small className="muted">Results are kept for about 3 days. Download the ones you want to keep.</small>}

            {history.length > 0 && (
              <div className="ws-recent">
                <h4>Recent</h4>
                <div className="ws-strip">
                  {history.map((h) => (
                    <button key={h.id} type="button" onClick={() => onRestore(h)} disabled={running} title="Restore this run">
                      {h.result.images?.[0] ? <img src={h.result.images[0]} alt="" /> : <span className="ws-strip-empty" />}
                      <span>{h.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
        </div>
      </div>

      <div className="ws-bar">
        <div className="ws-bar-info">
          <b>{costLabel}</b>
          {missing.length > 0 ? (
            <span className="ws-need">Still needed: {missing.join(', ')}</span>
          ) : (
            <span className="ws-readytext">{running ? status || 'Working…' : 'Ready to generate'}</span>
          )}
        </div>
        <div className="ws-bar-actions">
          {running && (
            <button type="button" className="ws-btn ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="ws-btn primary" disabled={running || missing.length > 0} onClick={onGenerate}>
            {running ? `Generating… ${elapsed}s` : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
