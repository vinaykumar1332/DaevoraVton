import { useState } from 'react';
import { Check, Download, FileSpreadsheet, Play, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { uploadMappingFile, saveManualMapping, startBatch } from '@/api/bulk.js';
import { downloadTemplate, TEMPLATE_COLUMNS } from '@/lib/bulkTemplate.js';

export const GARMENT_FIELDS = [
  ['top_image', 'Top'],
  ['bottom_image', 'Bottom'],
  ['dress_image', 'Dress'],
  ['saree_image', 'Saree'],
  ['shoes_image', 'Shoes'],
];

const emptyRow = () => ({ job_id: '', model_image: '', garment_field: 'top_image', garment_image: '', prompt_instruction: '' });

const SHEET_COLUMNS = TEMPLATE_COLUMNS;

function Preview({ mapping, busy, onStart }) {
  const n = mapping.jobCount;
  return (
    <section className="vb-card vb-step-card" aria-labelledby="vb-preview">
      <h2 id="vb-preview">Check before you start</h2>
      <p className="vb-lead">
        {n > 0 ? (
          <>
            <strong>{n}</strong> job{n === 1 ? '' : 's'} ready.
          </>
        ) : (
          'No job is ready yet.'
        )}
        {mapping.errors.length > 0 && ` ${mapping.errors.length} problem${mapping.errors.length === 1 ? '' : 's'} to fix.`}
      </p>

      {mapping.errors.length > 0 && (
        <ul className="vb-errors" role="alert">
          {mapping.errors.map((e, i) => (
            <li key={i}>
              Row {e.row}
              {e.field ? ` · ${e.field}` : ''}: {e.message}
            </li>
          ))}
        </ul>
      )}

      {n > 0 && (
        <div className="vb-scroll">
          <table className="vb-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Model</th>
                <th>Garment</th>
                <th>Category</th>
                <th>Output name</th>
              </tr>
            </thead>
            <tbody>
              {mapping.jobs.map((j) => (
                <tr key={j.jobId}>
                  <td>{j.jobId}</td>
                  <td>{j.input.model_image}</td>
                  <td>{j.input.product_image}</td>
                  <td>{j.category}</td>
                  <td>{j.outputName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="vb-actions vb-actions-end">
        <Button type="button" variant="primary" size="lg" disabled={busy || n === 0} onClick={onStart}>
          <Play aria-hidden="true" />
          Start {n} job{n === 1 ? '' : 's'}
        </Button>
      </div>
    </section>
  );
}

function SheetOption({ busy, onFile }) {
  const [name, setName] = useState('');
  return (
    <div className="vb-option-body">
      <p className="vb-lead">Use one sheet named <code>Generation_Jobs</code> (or a CSV with the same headers). Each row is one look.</p>
      <div className="vb-template">
        <Button type="button" variant="secondary" onClick={downloadTemplate}>
          <Download aria-hidden="true" /> Download template
        </Button>
        <small className="muted">A CSV file with the right columns. Open it in Excel and save as .xlsx if you prefer.</small>
      </div>
      <details className="vb-columns">
        <summary>Column names</summary>
        <p>{SHEET_COLUMNS.join(', ')}</p>
      </details>
      <label className="vb-drop vb-drop-compact">
        <input
          type="file"
          accept=".xlsx,.csv,text/csv"
          className="vb-file"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setName(f.name);
            onFile(f);
          }}
        />
        <span className="vb-drop-icon" aria-hidden="true">
          <FileSpreadsheet />
        </span>
        <strong>{name || 'Choose a .xlsx or .csv file'}</strong>
        <small>{name ? 'Checking the rows…' : 'Click to choose, then review the preview below'}</small>
      </label>
    </div>
  );
}

function ManualOption({ names, busy, onCheck }) {
  const [rows, setRows] = useState([emptyRow()]);
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  const payload = () => rows.map((r) => ({ job_id: r.job_id, model_image: r.model_image, [r.garment_field]: r.garment_image, prompt_instruction: r.prompt_instruction }));
  const ready = rows.every((r) => r.model_image && r.garment_image);

  return (
    <div className="vb-option-body">
      <p className="vb-lead">One look per row. Pick the model photo and one garment for each.</p>
      <div className="vb-rows">
        {rows.map((r, i) => (
          <fieldset className="vb-row-card" key={i}>
            <legend>Look {i + 1}</legend>
            <div className="vb-grid">
              <label className="vb-field">
                <span>Job ID</span>
                <input placeholder={`look-${i + 1}`} value={r.job_id} onChange={(e) => setRow(i, 'job_id', e.target.value)} />
              </label>
              <label className="vb-field">
                <span>Model photo</span>
                <select value={r.model_image} onChange={(e) => setRow(i, 'model_image', e.target.value)}>
                  <option value="">Choose…</option>
                  {names.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="vb-field">
                <span>Garment type</span>
                <select value={r.garment_field} onChange={(e) => setRow(i, 'garment_field', e.target.value)}>
                  {GARMENT_FIELDS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vb-field">
                <span>Garment photo</span>
                <select value={r.garment_image} onChange={(e) => setRow(i, 'garment_image', e.target.value)}>
                  <option value="">Choose…</option>
                  {names.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="vb-field vb-span-2">
                <span>
                  Instruction <em>(optional)</em>
                </span>
                <input placeholder="e.g. tuck in the shirt" value={r.prompt_instruction} onChange={(e) => setRow(i, 'prompt_instruction', e.target.value)} />
              </label>
            </div>
            <div className="vb-row-foot">
              <button type="button" className="vb-link vb-danger" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}>
                <Trash2 aria-hidden="true" /> Remove look
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="vb-actions">
        <Button type="button" variant="secondary" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          <Plus aria-hidden="true" /> Add look
        </Button>
        <Button type="button" variant="primary" disabled={busy || !ready} onClick={() => onCheck(payload())}>
          <Check aria-hidden="true" /> Check looks
        </Button>
      </div>
      {!ready && <p className="vb-hint">Choose a model photo and a garment photo for every look to check them.</p>}
    </div>
  );
}

/** Step 2: map the photos to looks, then check the preview and start. */
export function MappingStep({ batch, onBatch, onError, onStarted }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('sheet');
  const names = batch.images.map((i) => i.name);
  const mapping = batch.mapping;

  async function run(action) {
    setBusy(true);
    try {
      onBatch(await action());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      onStarted(await startBatch(batch.id));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vb-stack">
      <section className="vb-card vb-step-card" aria-labelledby="vb-map">
        <h2 id="vb-map">Map photos to looks</h2>
        <div className="vb-tabs" role="tablist" aria-label="How to map">
          <button type="button" role="tab" aria-selected={mode === 'sheet'} className={`vb-tab ${mode === 'sheet' ? 'on' : ''}`} onClick={() => setMode('sheet')}>
            <FileSpreadsheet aria-hidden="true" /> Upload a spreadsheet
          </button>
          <button type="button" role="tab" aria-selected={mode === 'manual'} className={`vb-tab ${mode === 'manual' ? 'on' : ''}`} onClick={() => setMode('manual')}>
            Map by hand
          </button>
        </div>

        {mode === 'sheet' ? (
          <SheetOption busy={busy} onFile={(f) => run(() => uploadMappingFile(batch.id, f))} />
        ) : (
          <ManualOption names={names} busy={busy} onCheck={(rows) => run(() => saveManualMapping(batch.id, rows))} />
        )}
      </section>

      {mapping && <Preview mapping={mapping} busy={busy} onStart={start} />}
    </div>
  );
}
