import { render, screen, waitFor } from '@testing-library/react';
import BulkVtonPage from '@/features/vton-bulk/BulkVtonPage.jsx';
import { saveBatch, listBatches, getBatch, forgetBatch } from '@/lib/bulkStore.js';

vi.mock('@/api/bulk.js', () => ({
  fetchBatch: vi.fn(),
  regenerateJob: vi.fn(),
  startBatch: vi.fn(),
  uploadZip: vi.fn(),
  uploadMappingFile: vi.fn(),
  saveManualMapping: vi.fn(),
  bulkServerReady: vi.fn(async () => true),
}));
import { fetchBatch } from '@/api/bulk.js';

const snapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Spring',
  createdAt: '2026-11-21T10:00:00.000Z',
  live: false,
  images: [{ name: 'm.png' }, { name: 't.png' }],
  rejected: [],
  mapping: null,
  summary: { total: 1, queued: 0, processing: 0, completed: 1, failed: 0, dryRun: 0, processingMs: 1200 },
  jobs: [
    {
      id: 'j-1',
      jobId: 'look-1',
      row: 2,
      status: 'completed',
      category: 'top',
      input: { model_image: 'm.png', product_image: 't.png', background_image: null, prompt_instruction: '' },
      instruction: '',
      analysis: null,
      prompt: 'The model wears the shirt.',
      predictionId: 'p',
      outputs: ['https://cdn.fashn.ai/a.png'],
      attempts: 1,
      timings: { totalMs: 1200 },
      error: null,
      createdAt: '2026-11-21T10:00:00.000Z',
      startedAt: '2026-11-21T10:00:01.000Z',
      completedAt: '2026-11-21T10:00:03.000Z',
      regeneratedAt: null,
      history: [],
    },
  ],
};

describe('bulk browser storage (memory fallback)', () => {
  afterEach(async () => {
    await forgetBatch(snapshot.id);
  });

  it('saves, lists and reads a batch snapshot', async () => {
    await saveBatch(snapshot);
    const list = await listBatches();
    expect(list.find((b) => b.id === snapshot.id)).toMatchObject({ name: 'Spring', summary: snapshot.summary });
    expect(await getBatch(snapshot.id)).toEqual(snapshot);
    await forgetBatch(snapshot.id);
    expect(await getBatch(snapshot.id)).toBeNull();
  });
});

describe('Bulk VTON page', () => {
  it('shows the upload step when there are no saved batches', async () => {
    render(<BulkVtonPage />);
    expect(await screen.findByRole('heading', { name: /upload your photos/i })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /progress/i })).toBeInTheDocument();
  });

  it('resumes the latest batch from the server and shows its jobs', async () => {
    await saveBatch(snapshot);
    fetchBatch.mockResolvedValue(snapshot);
    render(<BulkVtonPage />);
    expect(await screen.findByRole('heading', { name: /generation jobs/i })).toBeInTheDocument();
    expect(screen.getByText('look-1')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getByText(/The model wears the shirt/)).toBeInTheDocument();
    await waitFor(() => expect(fetchBatch).toHaveBeenCalledWith(snapshot.id));
    await forgetBatch(snapshot.id);
  });
});
