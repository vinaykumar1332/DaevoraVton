import { notify } from '@/lib/notify.js';
import { useState } from 'react';
import Lightbox from '@/components/common/Lightbox.jsx';
import CompareSlider from '@/components/common/CompareSlider.jsx';
import { downloadImage } from '@/api/fashn.js';

const slug = (s = 'result') => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'result';
const extOf = (url) => (url.split('?')[0].match(/\.(png|jpe?g|webp)$/i)?.[1] || 'png').toLowerCase();

/** A result tile that shimmers until the image has loaded, then fades in. */
function Tile({ url, i, onOpen, onDownload, onCopy }) {
  const [ready, setReady] = useState(false);
  return (
    <figure className="tile">
      <button type="button" className={`tile-img ${ready ? 'ready' : 'shimmer'}`} onClick={onOpen} aria-label={`Open result ${i + 1} full screen`}>
        <img src={url} alt={`Result ${i + 1}`} onLoad={() => setReady(true)} />
      </button>
      <figcaption>
        <span>Look {i + 1}</span>
        <span className="tile-actions">
          <button type="button" onClick={onDownload}>Download</button>
          <button type="button" onClick={onCopy}>Copy link</button>
        </span>
      </figcaption>
    </figure>
  );
}

export default function ResultsGallery({ result, before }) {
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('results'); // 'results' | 'compare'
  if (!result) return null;
  const { label = 'result', images = [], credits, steps = [] } = result;
  const base = slug(label);
  const canCompare = !!before && images.length > 0;

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      notify({ severity: 'success', summary: 'Link copied', life: 1500 });
    } catch {
      notify({ severity: 'warn', summary: 'Could not copy', detail: url, life: 4000 });
    }
  }

  async function download(url, i) {
    const ok = await downloadImage(url, `tryon-${base}-${i + 1}.${extOf(url)}`);
    if (!ok) {
      notify({
        severity: 'info',
        summary: 'Opened in a new tab',
        detail: 'Direct download was blocked. Right-click the image and choose Save image.',
        life: 4000,
      });
    }
  }

  async function downloadAll() {
    for (let i = 0; i < images.length; i++) {
      await download(images[i], i);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (images.length === 0) return <p className="muted">The job finished but returned no images. Try again with different photos.</p>;

  return (
    <div className="results">
      <div className="results-bar">
        {canCompare ? (
          <div className="seg" role="tablist" aria-label="Result view">
            <button type="button" role="tab" aria-selected={view === 'results'} className={view === 'results' ? 'on' : ''} onClick={() => setView('results')}>
              Results
            </button>
            <button type="button" role="tab" aria-selected={view === 'compare'} className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>
              Compare
            </button>
          </div>
        ) : (
          <span />
        )}
        <span className="results-meta">
          {credits != null && <span className="chip">{credits} credits used</span>}
          {images.length > 1 && (
            <button type="button" className="link-btn" onClick={downloadAll}>
              Download all {images.length}
            </button>
          )}
        </span>
      </div>

      {view === 'compare' && canCompare ? (
        <CompareSlider before={before} after={images[0]} onOpen={() => setOpen(0)} />
      ) : (
        <div className={`tiles n${Math.min(images.length, 4)}`}>
          {images.map((url, i) => (
            <Tile key={url + i} url={url} i={i} onOpen={() => setOpen(i)} onDownload={() => download(url, i)} onCopy={() => copy(url)} />
          ))}
        </div>
      )}

      {steps.length > 1 && (
        <div className="steps-strip">
          {steps.map((s, i) => (
            <figure key={i}>
              <img src={s.images[0]} alt={s.label} />
              <figcaption>{s.label}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {open != null && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onDownload={download} />}
    </div>
  );
}
