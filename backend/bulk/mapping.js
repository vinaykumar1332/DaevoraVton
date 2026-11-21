// Reads the Generation_Jobs mapping (CSV or Excel) and checks every row against the batch's images.
// A valid row is one generation job. Nothing is combined automatically.
import ExcelJS from 'exceljs';
import { LIMITS, MAPPING_FIELDS, GARMENT_FIELDS } from './config.js';
import { BulkError } from './zip.js';

const SHEET = 'Generation_Jobs';

/** Minimal CSV reader: quoted fields, commas inside quotes, CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

export async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new BulkError('CorruptMapping', 'The spreadsheet could not be read. Save it as .xlsx or CSV and try again.');
  }
  const sheet = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
  if (!sheet) throw new BulkError('SheetMissing', 'The spreadsheet has no sheets. Add a sheet named Generation_Jobs with the mapping rows.');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(row.values.slice(1).map((v) => (v == null ? '' : typeof v === 'object' && v.text ? v.text : String(v))));
  });
  return rows;
}

const truthy = (v) => !['false', '0', 'no', 'n'].includes(String(v ?? '').trim().toLowerCase());
const safeOutput = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);

/**
 * rows: array of arrays (first row is the header) or array of objects (manual mapping from the UI).
 * imageNames: the basenames extracted from the ZIP.
 * Returns { jobs, skipped, errors }. A job is only returned when its row has no errors.
 */
export function validateMapping(rows, imageNames) {
  const names = new Set(imageNames);
  const errors = [];
  const jobs = [];
  const skipped = [];
  const seenIds = new Set();

  let records;
  if (rows.length && !Array.isArray(rows[0])) {
    records = rows.map((r, i) => ({ row: i + 2, ...r }));
  } else {
    if (!rows.length) throw new BulkError('EmptyMapping', 'The mapping has no rows.');
    const header = rows[0].map((h) => String(h).trim().toLowerCase());
    if (!header.includes('model_image')) throw new BulkError('MissingColumn', 'The mapping needs a model_image column.');
    const unknown = header.filter((h) => h && !MAPPING_FIELDS.includes(h));
    records = rows.slice(1).map((cells, i) => {
      const obj = { row: i + 2 };
      header.forEach((h, c) => {
        if (h) obj[h] = cells[c] ?? '';
      });
      return obj;
    });
    if (unknown.length) errors.push({ row: 1, field: unknown.join(', '), message: 'Unknown column(s) were ignored.', level: 'info' });
  }

  for (const r of records) {
    const get = (k) => String(r[k] ?? '').trim();
    if (!truthy(get('enabled') || 'true')) {
      skipped.push({ row: r.row, reason: 'enabled is false' });
      continue;
    }
    const rowErrors = [];
    const model = get('model_image');
    if (!model) rowErrors.push({ field: 'model_image', message: 'A model image is required.' });
    else if (!names.has(model)) rowErrors.push({ field: 'model_image', message: `"${model}" is not in the ZIP.` });

    const garments = GARMENT_FIELDS.filter((f) => get(f));
    for (const f of [...GARMENT_FIELDS, 'background_image']) {
      const v = get(f);
      if (v && !names.has(v)) rowErrors.push({ field: f, message: `"${v}" is not in the ZIP.` });
    }
    if (!garments.length) rowErrors.push({ field: 'top_image', message: 'Add at least one garment image.' });
    if (garments.length > 1) rowErrors.push({ field: garments.join(', '), message: 'One garment per job for now. Split this row into one job per garment.' });

    const prompt = get('prompt_instruction');
    if (prompt.length > LIMITS.promptChars) rowErrors.push({ field: 'prompt_instruction', message: `Keep the instruction under ${LIMITS.promptChars} characters.` });

    const jobId = get('job_id') || `job-${r.row}`;
    if (seenIds.has(jobId)) rowErrors.push({ field: 'job_id', message: `job_id "${jobId}" is used twice.` });

    for (const e of rowErrors) errors.push({ row: r.row, ...e, level: 'error' });
    if (rowErrors.length) continue;

    seenIds.add(jobId);
    jobs.push({
      jobId,
      row: r.row,
      input: {
        model_image: model,
        product_image: garments[0] ? get(garments[0]) : null,
        background_image: get('background_image') || null,
        prompt_instruction: prompt,
      },
      category: garments[0].replace('_image', ''),
      outputName: safeOutput(get('output_name')) || safeOutput(jobId),
    });
  }
  return { jobs, skipped, errors };
}
