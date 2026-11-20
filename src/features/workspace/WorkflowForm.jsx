import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputNumber } from 'primereact/inputnumber';
import { Panel } from 'primereact/panel';
import ImageSlot from '@/components/common/ImageSlot.jsx';
import GarmentSlot from '@/components/common/GarmentSlot.jsx';
import { prepareFile } from '@/lib/imageIntake.js';
import { PRESET_GROUPS, PROMPT_TIPS } from '@/workflows/engines.js';

/** A plain list of image slots (used by the Bulk page). */
export function MultiImageInput({ value = [], onChange, max = 6, label = 'Image', onError }) {
  return (
    <div className="multi-images">
      {value.map((img, i) => (
        <ImageSlot
          key={i}
          compact
          label={`${label} ${i + 1}`}
          value={img}
          onError={onError}
          onChange={(v) => onChange(v ? value.map((x, k) => (k === i ? v : x)) : value.filter((_, k) => k !== i))}
        />
      ))}
      {value.length < max && (
        <ImageSlot
          key="new"
          compact
          label={`${label} ${value.length + 1}`}
          value={null}
          onError={onError}
          onChange={(v) => v && onChange([...value, v])}
        />
      )}
    </div>
  );
}

const isImageField = (f) => f.type === 'image' || f.type === 'images';

function isFilled(f, v) {
  if (f.type === 'image') return !!v;
  if (f.type === 'images') return (v || []).length > 0;
  if (f.type === 'text') return !!String(v ?? '').trim();
  return v != null && v !== '';
}

/** Split the fields into numbered step cards. A new card starts at each `section` heading. */
function groupFields(fields) {
  const groups = [];
  for (const f of fields) {
    const title = f.section ? f.section.replace(/^Step \d+ · /, '') : null;
    const last = groups[groups.length - 1];
    if (!last || (title && last.title !== title)) groups.push({ title: title ?? 'Settings', fields: [f] });
    else last.fields.push(f);
  }
  return groups;
}

/** Renders a workflow's fields as numbered step cards. Hidden fields are skipped. */
export default function WorkflowForm({ wf, values, setValues, disabled, exclude = [], onError }) {
  const fields = wf.fields.filter((f) => !f.hidden && !exclude.includes(f.key) && (!f.showIf || f.showIf(values)));
  const groups = groupFields(fields);

  return (
    <div className="wf-form">
      {groups.map((g, gi) => {
        const done = g.fields.some((f) => isImageField(f) && isFilled(f, values[f.key]));
        return (
          <section className={`step-card ${done ? 'done' : ''}`} key={`${gi}-${g.title}`}>
            <header className="step-head">
              <span className="step-num">{gi + 1}</span>
              <h4>{g.title}</h4>
              {done && (
                <span className="step-tick">
                  <i className="pi pi-check" /> Added
                </span>
              )}
            </header>
            <div className="step-body">
              <StepFields
                wf={wf}
                fields={g.fields}
                values={values}
                setValues={setValues}
                disabled={disabled}
                onError={onError}
              />
            </div>
          </section>
        );
      })}

      {wf.presets && (
        <Panel header="Prompting tips" toggleable collapsed className="tips">
          <ul>
            {PROMPT_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function StepFields({ wf, fields, values, setValues, disabled, onError }) {
  const setField = (key, val) => setValues((cur) => ({ ...cur, [key]: val }));
  const applyPreset = (p) => setValues((cur) => ({ ...cur, prompt: p.prompt, ...(p.settings ?? {}) }));

  // Consecutive photo fields share one grid of tiles.
  const blocks = [];
  for (const f of fields) {
    const last = blocks[blocks.length - 1];
    if (isImageField(f) && last?.tiles) last.fields.push(f);
    else blocks.push({ tiles: isImageField(f), fields: [f] });
  }

  return (
    <>
      {wf.presets && fields.some((f) => f.key === 'prompt') && (
        <div className="wf-field">
          <div className="wf-label">Start from a preset</div>
          <Dropdown
            className="w-full"
            options={PRESET_GROUPS}
            optionGroupLabel="label"
            optionGroupChildren="items"
            optionLabel="label"
            value={null}
            placeholder="Choose a preset (fills the prompt)…"
            disabled={disabled}
            onChange={(e) => e.value && applyPreset(e.value)}
            itemTemplate={(p) => (
              <div className="preset-item">
                <span>{p.label}</span>
                <small className="muted">
                  {p.needs}
                  {p.settings ? ` · sets ${Object.values(p.settings).join(', ')}` : ''}
                </small>
              </div>
            )}
          />
        </div>
      )}

      {blocks.map((b, i) =>
        b.tiles ? (
          <TileGrid key={i} fields={b.fields} values={values} setValues={setValues} onError={onError} />
        ) : (
          <FieldInput
            key={b.fields[0].key}
            f={b.fields[0]}
            value={values[b.fields[0].key]}
            disabled={disabled}
            onError={onError}
            onChange={(v) => setField(b.fields[0].key, v)}
          />
        )
      )}
    </>
  );
}

/** Photo tiles for one step. Each tile is one photo; a multi-photo field grows as photos are added.
 *  A field with `pairWith: '<key>'` is the back view of that field and is drawn inside its GarmentSlot. */
export function TileGrid({ fields, values, setValues, onError, disabled = false, maxPhotos }) {
  const backs = new Map(fields.filter((f) => f.pairWith).map((f) => [f.pairWith, f]));
  const tiles = [];
  for (const f of fields) {
    if (f.pairWith) continue;
    const short = f.label.replace(/ photos?.*$/i, '');
    if (f.type === 'image') {
      const back = backs.get(f.key);
      if (back) tiles.push({ pair: true, f, back, label: short, hint: f.hint, required: f.required });
      else tiles.push({ f, idx: 0, src: values[f.key], label: f.label, hint: f.hint, required: f.required });
    } else {
      const list = values[f.key] || [];
      list.forEach((img, i) => tiles.push({ f, idx: i, src: img, label: `${short} ${i + 1}`, hint: f.hint, required: f.required }));
      if (list.length < (f.max ?? 6)) {
        tiles.push({ f, idx: list.length, src: null, label: `${short} ${list.length + 1}`, hint: f.hint, required: f.required });
      }
    }
  }

  const setOne = (key, img) => setValues((cur) => ({ ...cur, [key]: img }));

  function update(t, img) {
    setValues((cur) => {
      if (t.f.type === 'image') return { ...cur, [t.f.key]: img };
      const list = [...(cur[t.f.key] || [])];
      if (img == null) list.splice(t.idx, 1);
      else if (t.idx < list.length) list[t.idx] = img;
      else list.push(img);
      return { ...cur, [t.f.key]: list };
    });
  }

  const used = fields.reduce((n, f) => n + (f.type === 'image' ? (values[f.key] ? 1 : 0) : (values[f.key] || []).length), 0);

  // Dropping two or more photos fills the empty main tiles in order (back views are always added by hand).
  async function onDropMany(e) {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length < 2 || disabled) return; // a single file is handled by the tile it lands on
    e.preventDefault();
    e.stopPropagation();

    const results = await Promise.allSettled(files.map((file) => prepareFile(file)));
    const photos = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) onError?.(failed[0].reason?.message + (failed.length > 1 ? ` (${failed.length} photos skipped)` : ''));
    if (!photos.length) return;

    const pending = [...photos];
    const changes = {};
    for (const f of fields) {
      if (!pending.length) break;
      if (f.pairWith) continue;
      if (f.type === 'image' && !values[f.key]) changes[f.key] = pending.shift();
      if (f.type === 'images') {
        const list = [...(values[f.key] || [])];
        while (pending.length && list.length < (f.max ?? 6)) list.push(pending.shift());
        changes[f.key] = list;
      }
    }
    setValues((cur) => ({ ...cur, ...changes }));
    if (pending.length) onError?.(`${pending.length} photo(s) did not fit. The empty slots are full.`);
  }

  return (
    <div className="tile-block" onDropCapture={onDropMany} onDragOver={(e) => e.preventDefault()}>
      <div className={`tile-grid cols-${Math.min(tiles.length, 3)}`}>
        {tiles.map((t, i) =>
          t.pair ? (
            <GarmentSlot
              key={`${t.f.key}-pair`}
              label={t.label}
              hint={t.hint}
              required={t.required}
              disabled={disabled}
              front={values[t.f.key]}
              back={values[t.back.key]}
              onFront={(img) => setOne(t.f.key, img)}
              onBack={(img) => setOne(t.back.key, img)}
              onError={onError}
            />
          ) : (
            <ImageSlot
              key={`${t.f.key}-${i}`}
              compact
              label={t.label}
              hint={t.hint}
              required={t.required}
              disabled={disabled}
              value={t.src}
              onError={onError}
              onChange={(img) => update(t, img)}
            />
          )
        )}
      </div>
      {maxPhotos && (
        <small className={`tile-count ${used > maxPhotos ? 'over' : ''}`} aria-live="polite">
          {used} of {maxPhotos} photos used{used > maxPhotos ? `. Remove ${used - maxPhotos} to continue.` : ''}
        </small>
      )}
    </div>
  );
}

export function FieldInput({ f, value, onChange, disabled }) {
  const title = (
    <div className="wf-label">
      {f.label}
      {f.required && <span className="required"> *</span>}
    </div>
  );

  switch (f.type) {
    case 'text':
      return (
        <div className="wf-field">
          {title}
          {f.multiline ? (
            <InputTextarea
              className="w-full"
              rows={4}
              autoResize
              value={value}
              disabled={disabled}
              placeholder={f.placeholder}
              maxLength={f.max}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <InputText
              className="w-full"
              value={value}
              disabled={disabled}
              placeholder={f.placeholder}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
          {f.max && <small className="muted">{(value || '').length.toLocaleString()} / {f.max.toLocaleString()}</small>}
        </div>
      );

    case 'select':
      return (
        <div className="wf-field">
          {title}
          <Dropdown className="w-full" value={value} options={f.options} disabled={disabled} onChange={(e) => onChange(e.value)} />
        </div>
      );

    case 'number':
      return (
        <div className="wf-field">
          {title}
          <InputNumber
            className="w-full"
            value={value}
            min={f.min}
            max={f.max}
            useGrouping={false}
            showButtons
            disabled={disabled}
            onValueChange={(e) => onChange(e.value ?? f.default)}
          />
          {f.hint && <small className="muted">{f.hint}</small>}
        </div>
      );

    default:
      return null;
  }
}
