import { Fragment, useRef, useState } from 'react';
import { Download, Loader2, Square, Table2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import OptionSelect from '@/components/common/OptionSelect.jsx';
import WorkflowForm, { MultiImageInput } from '@/features/workspace/WorkflowForm.jsx';
import { WORKFLOWS, defaultValues, missingFields } from '@/workflows/engines.js';
import { downloadImage } from '@/api/fashn.js';
import { friendlyError } from '@/lib/messages.js';

const BULK_WFS = WORKFLOWS.filter((w) => w.bulk).map((w) => ({ label: w.label, value: w.id }));
const CONCURRENCY = 3;
const MAX_JOBS = 60;

export default function BulkPanel({ onDone, onRunsChanged }) {
  const [wfId, setWfId] = useState('tryon-max');
  const wf = WORKFLOWS.find((w) => w.id === wfId);
  const [values, setValues] = useState(() => defaultValues(wf));
  const [rows, setRows] = useState([]);
  const [cols, setCols] = useState([]);
  const [cells, setCells] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef(null);

  const rowKey = wf.bulk.rows;
  const colKey = wf.bulk.cols;
  const total = rows.length * cols.length;
  const tooMany = total > MAX_JOBS;
  const missing = total ? missingFields(wf, { ...values, [rowKey]: true, [colKey]: true }) : [];
  const per = wf.credits ? wf.credits(values) : null;
  const estimate = per != null ? per * total : null;
  const doneCells = Object.values(cells).filter((c) => c.status === 'done' && c.images?.[0]);

  function pickWorkflow(id) {
    if (running) return;
    setWfId(id);
    setValues(defaultValues(WORKFLOWS.find((w) => w.id === id)));
    setCells({});
    setProgress({ done: 0, total: 0 });
  }

  async function runBulk() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const jobs = [];
    rows.forEach((r, i) => cols.forEach((c, j) => jobs.push({ i, j, r, c })));
    setCells(Object.fromEntries(jobs.map((j) => [`${j.i}:${j.j}`, { status: 'queued' }])));
    setProgress({ done: 0, total: jobs.length });
    setRunning(true);

    const setCell = (key, patch) => setCells((cs) => ({ ...cs, [key]: { ...cs[key], ...patch } }));
    const queue = [...jobs];
    let done = 0;

    const worker = async () => {
      while (queue.length && !ctrl.signal.aborted) {
        const job = queue.shift();
        const key = `${job.i}:${job.j}`;
        const inputs = { ...values, [rowKey]: job.r, [colKey]: job.c };
        setCell(key, { status: 'running' });
        try {
          const out = await wf.run(inputs, { signal: ctrl.signal, onStatus: () => {} });
          setCell(key, { status: 'done', images: out.images, credits: out.credits });
          onDone?.({ wfId: wf.id, values: inputs, result: { label: `${wf.label} ${job.i + 1}x${job.j + 1}`, wfId: wf.id, ...out } });
        } catch (e) {
          if (ctrl.signal.aborted || e?.name === 'AbortError') setCell(key, { status: 'cancelled' });
          else {
            const f = friendlyError(e);
            setCell(key, { status: 'error', title: f.title, error: f.detail });
          }
        }
        done += 1;
        setProgress({ done, total: jobs.length });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    setCells((cs) =>
      Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, v.status === 'queued' ? { ...v, status: 'cancelled' } : v]))
    );
    setRunning(false);
    abortRef.current = null;
    onRunsChanged?.();
  }

  async function downloadAll() {
    for (let i = 0; i < doneCells.length; i++) {
      await downloadImage(doneCells[i].images[0], `fashn-bulk-${i + 1}.png`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return (
    <div className="bulk-page">
      <div className="wf-head">
        <div>
          <h2>
            <Table2 className="inline size-5 align-text-bottom" /> Bulk grid
          </h2>
          <p className="muted">
            Every model × every garment becomes one try-on job. Up to {CONCURRENCY} run at once. Each cell can be opened or downloaded.
          </p>
        </div>
      </div>

      <div className="wf-grid">
        <section className="panel wf-inputs">
          <div className="wf-field">
            <div className="wf-label">Engine</div>
            <OptionSelect value={wfId} options={BULK_WFS} disabled={running} onChange={pickWorkflow} aria-label="Engine" />
          </div>

          <div className="wf-field">
            <div className="wf-label">Models (rows)</div>
            <MultiImageInput value={rows} onChange={setRows} max={12} label="Model" />
          </div>
          <div className="wf-field">
            <div className="wf-label">Garments (columns)</div>
            <MultiImageInput value={cols} onChange={setCols} max={12} label="Garment" />
          </div>

          <WorkflowForm wf={wf} values={values} setValues={setValues} disabled={running} exclude={[rowKey, colKey]} />

          <div className="wf-footer">
            <div className="cost">
              {total} job(s)
              {estimate != null ? ` · ≈ ${estimate} credits` : ''}
            </div>
            {tooMany && <small className="need">Max {MAX_JOBS} jobs per batch. Remove some models or garments.</small>}
            {!tooMany && total > 0 && missing.length > 0 && <small className="need">Required: {missing.join(', ')}</small>}
            <div className="gen-row">
              {running && (
                <Button variant="outline" className="border-destructive text-destructive hover:text-destructive" onClick={() => abortRef.current?.abort()}>
                  <Square /> Cancel
                </Button>
              )}
              <Button disabled={running || total === 0 || tooMany || missing.length > 0} onClick={runBulk}>
                {running ? <Loader2 className="animate-spin" /> : <Zap />}
                {running ? 'Running…' : `Run ${total} job(s)`}
              </Button>
            </div>
          </div>
        </section>

        <section className="panel wf-results">
          {progress.total > 0 && (
            <>
              <div className="status-line">
                <span>
                  {progress.done} / {progress.total} done
                </span>
              </div>
              <Progress value={Math.round((progress.done / progress.total) * 100)} className="h-1.5" />
            </>
          )}

          {total === 0 ? (
            <div className="placeholder">
              <Table2 />
              <p>Add models and garments to see the grid.</p>
            </div>
          ) : (
            <div className="bulk-scroll">
              <div className="bulk-grid" style={{ gridTemplateColumns: `110px repeat(${cols.length}, minmax(150px, 1fr))` }}>
                <div />
                {cols.map((c, j) => (
                  <div key={`c${j}`} className="bulk-head">
                    <img src={c.src} alt="" />
                    <span>Garment {j + 1}</span>
                  </div>
                ))}
                {rows.map((r, i) => (
                  <Fragment key={`r${i}`}>
                    <div className="bulk-head">
                      <img src={r.src} alt="" />
                      <span>Model {i + 1}</span>
                    </div>
                    {cols.map((_, j) => (
                      <BulkCell key={j} cell={cells[`${i}:${j}`]} />
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {doneCells.length > 0 && (
            <Button variant="outline" className="mt" onClick={downloadAll}>
              <Download /> Download all ({doneCells.length})
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}

function BulkCell({ cell }) {
  if (!cell) return <div className="bulk-cell muted">—</div>;
  if (cell.status === 'done' && cell.images?.[0]) {
    return (
      <div className="bulk-cell">
        <a href={cell.images[0]} target="_blank" rel="noreferrer">
          <img src={cell.images[0]} alt="" />
        </a>
        {cell.images.length > 1 && <small>+{cell.images.length - 1} more</small>}
      </div>
    );
  }
  const labels = { queued: 'Queued', running: 'Running…', cancelled: 'Cancelled', error: 'Error', done: 'No image' };
  return (
    <div className={`bulk-cell state-${cell.status}`}>
      <span>
        {cell.status === 'error' ? cell.title : labels[cell.status]}
      </span>
      {cell.error && <small title={cell.error}>{cell.error.slice(0, 90)}</small>}
    </div>
  );
}
