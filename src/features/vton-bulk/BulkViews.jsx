import { useState } from 'react';
import { Download, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';

const ACTIVE = ['queued', 'analysing', 'generating'];
const STATUS_LABEL = {
  queued: 'Queued',
  analysing: 'Analysing',
  generating: 'Generating',
  completed: 'Completed',
  failed: 'Failed',
  dry_run: 'Dry run',
};

export const isActive = (batch) => !!batch?.jobs?.some((j) => ACTIVE.includes(j.status));

export function formatDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function ResultCell({ job }) {
  const url = job.outputs?.[0];
  if (!url) return <span className="muted">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="vb-thumb" aria-label={`Open result for ${job.jobId}`}>
      <img src={url} alt={`Result for ${job.jobId}`} loading="lazy" decoding="async" />
    </a>
  );
}

function JobRow({ job, onRegenerate, busy }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState(job.instruction ?? '');
  const analysis = job.prompt ? (job.analysis?.dryRun ? 'Dry run' : 'Ready') : job.status === 'analysing' ? 'Analysing' : job.status === 'failed' ? 'Failed' : '—';
  const canRegen = ['completed', 'failed', 'dry_run'].includes(job.status);
  return (
    <tr>
      <td>{job.jobId}</td>
      <td>{job.input.model_image}</td>
      <td>{job.input.product_image}</td>
      <td>{job.category}</td>
      <td>{analysis}</td>
      <td className="vb-prompt">
        {job.prompt ? (
          <details>
            <summary>View prompt</summary>
            <p>{job.prompt}</p>
          </details>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <span className={`vb-status s-${job.status}`}>{STATUS_LABEL[job.status] ?? job.status}</span>
        {job.error && <div className="vb-err">{job.error.message}</div>}
      </td>
      <td>{when(job.createdAt)}</td>
      <td>{when(job.completedAt)}</td>
      <td>{formatDuration(job.timings?.totalMs)}</td>
      <td>
        <ResultCell job={job} />
        {job.history?.length > 0 && <div className="muted">{job.history.length} earlier</div>}
      </td>
      <td className="vb-action">
        {job.outputs?.[0] && (
          <a className="vb-link" href={job.outputs[0]} target="_blank" rel="noreferrer">
            <Download aria-hidden="true" /> Download
          </a>
        )}
        {canRegen && (
          <button type="button" className="vb-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <RotateCw aria-hidden="true" /> Regenerate
          </button>
        )}
        {open && (
          <div className="vb-regen">
            <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={500} aria-label="Instruction for this look" rows={3} />
            <Button type="button" variant="primary" disabled={busy} onClick={() => onRegenerate(job, instruction)}>
              Run again
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function Dashboard({ batch, onRegenerate, busy }) {
  const s = batch.summary;
  const tiles = [
    ['Total', s.total],
    ['Queued', s.queued],
    ['Processing', s.processing],
    ['Completed', s.completed],
    ['Failed', s.failed],
    ['Dry run', s.dryRun],
    ['Processing time', formatDuration(s.processingMs)],
  ];
  return (
    <div className="vb-stack">
      <section className="vb-card">
        <h2>{batch.name}</h2>
        <p className="muted">
          Uploaded {when(batch.createdAt)} · {batch.images.length} valid image{batch.images.length === 1 ? '' : 's'}
          {batch.rejected.length ? ` · ${batch.rejected.length} rejected` : ''}
        </p>
        {!batch.live && (
          <p className="vb-notice" role="status">
            Live generation is off on this server, so jobs finish as dry runs. Start the backend with BULK_LIVE=1 to generate images.
          </p>
        )}
        <div className="vb-tiles">
          {tiles.map(([label, value]) => (
            <div className="vb-tile" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {batch.rejected.length > 0 && (
          <details>
            <summary>Rejected files ({batch.rejected.length})</summary>
            <ul className="vb-errors">
              {batch.rejected.map((r, i) => (
                <li key={i}>
                  {r.name}: {r.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="vb-card" aria-labelledby="vb-jobs">
        <h2 id="vb-jobs">Generation jobs</h2>
        <div className="vb-scroll">
          <table className="vb-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Model</th>
                <th>Garment</th>
                <th>Category</th>
                <th>Analysis</th>
                <th>Dynamic prompt</th>
                <th>Generation</th>
                <th>Created</th>
                <th>Completed</th>
                <th>Duration</th>
                <th>Result</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {batch.jobs.map((j) => (
                <JobRow key={j.id} job={j} onRegenerate={onRegenerate} busy={busy} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
