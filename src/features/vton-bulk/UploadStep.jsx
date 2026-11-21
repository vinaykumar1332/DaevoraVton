import { useState } from 'react';
import { Check, FileArchive, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { uploadZip } from '@/api/bulk.js';

export const STEPS = [
  { key: 'upload', label: 'Upload photos', hint: 'A ZIP of up to 20 images' },
  { key: 'map', label: 'Map to looks', hint: 'Pick a model and a garment per look' },
  { key: 'generate', label: 'Generate', hint: 'Review results and regenerate' },
];

export function Stepper({ current }) {
  const at = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="vb-steps" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'current' : 'todo';
        return (
          <li key={s.key} className={`vb-step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="vb-dot" aria-hidden="true">
              {state === 'done' ? <Check /> : i + 1}
            </span>
            <span className="vb-step-text">
              <strong>{s.label}</strong>
              <small>{s.hint}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const MAX_ZIP_MB = 60;

export function UploadStep({ onCreated, onError, serverReady }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [progress, setProgress] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState(null);

  const choose = (f) => {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) {
      setFile(null);
      setFileError('Choose a .zip file. Folders, RAR and 7z files are not accepted.');
      return;
    }
    if (f.size > MAX_ZIP_MB * 1024 * 1024) {
      setFile(null);
      setFileError(`That ZIP is larger than ${MAX_ZIP_MB} MB. Split it into smaller batches.`);
      return;
    }
    setFileError(null);
    setFile(f);
  };

  const blockedReason =
    serverReady === false ? 'The bulk server is not running. Start it, then reload this page.' : !file ? 'Choose a ZIP file to continue.' : null;

  async function submit(e) {
    e.preventDefault();
    if (blockedReason) return;
    setProgress(0);
    try {
      onCreated(await uploadZip(file, name, setProgress));
    } catch (err) {
      onError(err);
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="vb-card vb-step-card" aria-labelledby="vb-upload">
      <h2 id="vb-upload">Upload your photos</h2>
      <p className="vb-lead">Add one ZIP with up to 20 JPG, PNG or WEBP images. Folders inside the ZIP are fine.</p>

      <form className="vb-form" onSubmit={submit}>
        <label className="vb-field">
          <span>
            Batch name <em>(optional)</em>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring collection" maxLength={80} />
        </label>

        <label
          className={`vb-drop ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files?.[0]);
          }}
        >
          <input type="file" accept=".zip,application/zip" className="vb-file" onChange={(e) => choose(e.target.files?.[0])} />
          <span className="vb-drop-icon" aria-hidden="true">
            {file ? <FileArchive /> : <Upload />}
          </span>
          {file ? (
            <>
              <strong>{file.name}</strong>
              <small>{(file.size / 1048576).toFixed(1)} MB · ready to upload · click to pick another</small>
            </>
          ) : (
            <>
              <strong>Drop your ZIP here, or click to choose</strong>
              <small>ZIP files only, up to {MAX_ZIP_MB} MB</small>
            </>
          )}
        </label>

        {fileError && (
          <p className="vb-hint is-error" role="alert">
            {fileError}
          </p>
        )}

        {progress !== null && (
          <div className="vb-upload-progress">
            <progress value={progress} max={1} aria-label="Upload progress" />
            <span>Uploading… {Math.round(progress * 100)}%</span>
          </div>
        )}

        <div className="vb-actions">
          <Button type="submit" variant="primary" disabled={!!blockedReason || progress !== null}>
            <Upload aria-hidden="true" />
            Upload ZIP
          </Button>
          {blockedReason && progress === null && <p className="vb-hint">{blockedReason}</p>}
        </div>
      </form>
    </section>
  );
}
