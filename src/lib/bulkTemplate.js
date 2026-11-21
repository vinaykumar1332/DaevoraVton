// The mapping template users download. One row per look. Headers match what the server reads.
export const TEMPLATE_COLUMNS = [
  'job_id',
  'model_image',
  'top_image',
  'bottom_image',
  'dress_image',
  'saree_image',
  'shoes_image',
  'background_image',
  'prompt_instruction',
  'output_name',
  'enabled',
];

const EXAMPLE_ROWS = [
  ['look-1', 'model-1.jpg', 'blue-shirt.jpg', '', '', '', '', '', 'tuck in the shirt', 'spring-look-1', 'true'],
  ['look-2', 'model-2.png', '', '', 'white-dress.webp', '', '', '', '', 'spring-look-2', 'true'],
];

const cell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV text: the header row, then example rows the user replaces with their own file names. */
export function templateCsv() {
  return [TEMPLATE_COLUMNS, ...EXAMPLE_ROWS].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Starts a browser download of the template. */
export function downloadTemplate() {
  const blob = new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'generation_jobs_template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
