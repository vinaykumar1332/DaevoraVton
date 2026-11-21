import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { extractImages, imageSize, BulkError, cleanBaseName } from '../../../backend/bulk/zip.js';
import { parseCsv, validateMapping } from '../../../backend/bulk/mapping.js';
import { createRunner, planJobs, summarize } from '../../../backend/bulk/jobs.js';
import { createBatch, loadBatch, storeRoot } from '../../../backend/bulk/store.js';

/** A PNG header with the given size (enough for the dimension check; the body is not decoded). */
function png(w, h, salt = 0) {
  const b = Buffer.alloc(33 + salt);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b.fill(salt & 0xff, 33);
  return b;
}

async function zipOf(files) {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: 'nodebuffer' });
}

describe('ZIP ingestion', () => {
  it('accepts five valid images', async () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}.png`, png(1024, 1536, i + 1)]));
    const { images, rejected } = await extractImages(await zipOf(files));
    expect(images).toHaveLength(5);
    expect(rejected).toEqual([]);
  });

  it('accepts exactly 20 and rejects 21 after extraction', async () => {
    const twenty = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}.png`, png(600, 800, i + 1)]));
    expect((await extractImages(await zipOf(twenty))).images).toHaveLength(20);
    const twentyOne = { ...twenty, 'extra.png': png(600, 800, 99) };
    await expect(extractImages(await zipOf(twentyOne))).rejects.toMatchObject({ code: 'TooManyImages' });
  });

  it('counts images in nested folders, so folders cannot bypass the limit', async () => {
    const files = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`a/b/c/p${i}.png`, png(600, 800, i + 1)]));
    await expect(extractImages(await zipOf(files))).rejects.toMatchObject({ code: 'TooManyImages' });
  });

  it('rejects a corrupted archive', async () => {
    await expect(extractImages(Buffer.from('not a zip at all'))).rejects.toMatchObject({ code: 'CorruptArchive' });
  });

  it('rejects path traversal and absolute paths', async () => {
    await expect(extractImages(await zipOf({ '../escape.png': png(600, 800) }))).rejects.toMatchObject({ code: 'UnsafePath' });
    expect(() => cleanBaseName('/etc/passwd.png')).toThrow(BulkError);
  });

  it('flags duplicates, wrong content, small images and skips system files', async () => {
    const same = png(600, 800, 7);
    const { images, rejected } = await extractImages(
      await zipOf({
        'a.png': same,
        'copy.png': same,
        'fake.png': Buffer.from('this is not a png, just text padding padding padding'),
        'tiny.png': png(100, 100, 3),
        '__MACOSX/._a.png': png(600, 800, 4),
        '.DS_Store': Buffer.from('x'),
        'notes.txt': Buffer.from('hello'),
      })
    );
    expect(images.map((i) => i.name)).toEqual(['a.png']);
    const reasons = Object.fromEntries(rejected.map((r) => [r.name, r.reason]));
    expect(reasons['copy.png']).toMatch(/Duplicate/);
    expect(reasons['fake.png']).toMatch(/does not match/);
    expect(reasons['tiny.png']).toMatch(/outside/);
    expect(reasons['notes.txt']).toMatch(/Not a JPG/);
  });

  it('reads sizes from PNG and JPEG headers', () => {
    expect(imageSize(png(1200, 1600), 'png')).toEqual({ width: 1200, height: 1600 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x00, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(imageSize(jpeg, 'jpeg')).toEqual({ width: 768, height: 512 });
  });
});

describe('mapping', () => {
  const names = ['model1.png', 'top1.png', 'bottom1.png', 'shoes1.png', 'bg.png'];

  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('turns a valid row into one job and leaves unused garment fields empty', () => {
    const rows = [
      ['model_image', 'top_image', 'bottom_image', 'shoes_image', 'output_name'],
      ['model1.png', 'top1.png', '', '', 'look one'],
    ];
    const { jobs, errors } = validateMapping(rows, names);
    expect(errors).toEqual([]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].input).toMatchObject({ model_image: 'model1.png', product_image: 'top1.png' });
    expect(jobs[0].outputName).toBe('look_one');
  });

  it('reports missing references and rows with no garment', () => {
    const rows = [
      ['model_image', 'top_image'],
      ['missing.png', 'top1.png'],
      ['model1.png', ''],
    ];
    const { jobs, errors } = validateMapping(rows, names);
    expect(jobs).toEqual([]);
    expect(errors.map((e) => e.message).join(' ')).toMatch(/missing\.png" is not in the ZIP/);
    expect(errors.map((e) => e.message).join(' ')).toMatch(/Add at least one garment/);
  });

  it('asks for one garment per job and rejects duplicate job ids', () => {
    const rows = [
      ['job_id', 'model_image', 'top_image', 'bottom_image'],
      ['j1', 'model1.png', 'top1.png', 'bottom1.png'],
      ['j1', 'model1.png', 'top1.png', ''],
    ];
    const { jobs, errors } = validateMapping(rows, names);
    expect(jobs).toHaveLength(1);
    expect(errors.some((e) => /One garment per job/.test(e.message))).toBe(true);
    expect(errors.some((e) => /used twice/.test(e.message))).toBe(false);
  });

  it('skips rows marked disabled', () => {
    const rows = [
      ['model_image', 'top_image', 'enabled'],
      ['model1.png', 'top1.png', 'no'],
    ];
    const { jobs, skipped } = validateMapping(rows, names);
    expect(jobs).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});

describe('job runner', () => {
  const batch = () => ({ id: 'b1', owner: 'me', jobs: [] });
  const rows = [0, 1, 2].map((i) => ({ jobId: `j${i}`, row: i + 2, category: 'top', input: { model_image: 'm.png', product_image: 't.png', prompt_instruction: '' }, outputName: `o${i}` }));

  it('runs every job and keeps timings', async () => {
    const b = batch();
    b.jobs = planJobs(rows);
    const deps = {
      analyse: vi.fn(async () => ({ prompt: 'a prompt', reply: '' })),
      generate: vi.fn(async () => ({ predictionId: 'p', outputs: ['https://cdn.fashn.ai/x.png'] })),
    };
    const runner = createRunner({ deps, save: () => {}, concurrency: 2 });
    await runner.start(b);
    expect(b.jobs.every((j) => j.status === 'completed')).toBe(true);
    expect(deps.generate).toHaveBeenCalledTimes(3);
    expect(b.jobs[0].timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(summarize(b.jobs)).toMatchObject({ total: 3, completed: 3, failed: 0 });
  });

  it('records a failure and carries on with the other jobs', async () => {
    const b = batch();
    b.jobs = planJobs(rows);
    const deps = {
      analyse: async () => ({ prompt: 'p' }),
      generate: vi.fn(async ({ job }) => {
        if (job.jobId === 'j1') throw Object.assign(new Error('boom'), { code: 'GenerationFailed' });
        return { predictionId: 'p', outputs: ['u'] };
      }),
    };
    await createRunner({ deps, save: () => {}, concurrency: 1 }).start(b);
    expect(b.jobs.find((j) => j.jobId === 'j1')).toMatchObject({ status: 'failed', error: { code: 'GenerationFailed' } });
    expect(summarize(b.jobs)).toMatchObject({ completed: 2, failed: 1 });
  });

  it('regenerates without overwriting the previous output, and reuses the analysis when the instruction is unchanged', async () => {
    const b = batch();
    b.jobs = planJobs([rows[0]]);
    const analyse = vi.fn(async () => ({ prompt: 'p' }));
    const deps = { analyse, generate: vi.fn(async () => ({ predictionId: 'p2', outputs: ['new.png'] })) };
    const runner = createRunner({ deps, save: () => {}, concurrency: 1 });
    await runner.start(b);
    const job = b.jobs[0];
    job.outputs = ['first.png'];
    job.predictionId = 'p1';
    await runner.regenerate(b, job);
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(job.history[0]).toMatchObject({ outputs: ['first.png'], predictionId: 'p1' });
    expect(job.outputs).toEqual(['new.png']);
    expect(job.regeneratedAt).toBeTruthy();

    await runner.regenerate(b, job, { instruction: 'make the jacket navy' });
    expect(analyse).toHaveBeenCalledTimes(2);
    expect(job.history).toHaveLength(2);
  });

  it('dry runs finish as dry_run and never call generation', async () => {
    const b = batch();
    b.jobs = planJobs([rows[0]]);
    const deps = { analyse: async () => ({ dryRun: true, prompt: null }), generate: vi.fn() };
    await createRunner({ deps, save: () => {}, concurrency: 1 }).start(b);
    expect(b.jobs[0].status).toBe('dry_run');
    expect(deps.generate).not.toHaveBeenCalled();
  });
});

describe('batch privacy', () => {
  it('only the owner can load a batch', () => {
    const batch = createBatch({ owner: 'alice', name: 'test', images: [], rejected: [] });
    try {
      expect(loadBatch(batch.id, 'alice')).not.toBeNull();
      expect(loadBatch(batch.id, 'bob')).toBeNull();
      expect(loadBatch('../../etc', 'alice')).toBeNull();
    } finally {
      fs.rmSync(path.join(storeRoot, batch.id), { recursive: true, force: true });
    }
  });
});

describe('mapping template', () => {
  it('the downloadable template parses into a valid job row', async () => {
    const { templateCsv } = await import('@/lib/bulkTemplate.js');
    const rows = parseCsv(templateCsv());
    expect(rows[0]).toContain('model_image');
    const result = validateMapping(rows, ['model-1.jpg', 'blue-shirt.jpg', 'sneakers.png', 'model-2.png', 'white-dress.webp']);
    expect(result.jobs.map((j) => j.jobId)).toEqual(['look-1', 'look-2']);
    expect(result.jobs[0].input.product_image).toBe('blue-shirt.jpg');
  });
});

describe('spreadsheet sheet name', () => {
  it('uses the first sheet when it is not named Generation_Jobs', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const { parseXlsx } = await import('../../../backend/bulk/mapping.js');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['job_id', 'model_image', 'top_image']);
    ws.addRow(['look-1', 'model.png', 'top.png']);
    const rows = await parseXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows[1]).toEqual(['look-1', 'model.png', 'top.png']);
  });
});
