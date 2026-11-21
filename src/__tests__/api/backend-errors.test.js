import { backendEnhanceRequest, backendAnalyzePhoto } from '@/api/backend.js';

vi.mock('@/lib/imageShrink.js', () => ({ fitPayload: async (b) => b }));

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('backend API errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a dropped connection becomes a NetworkError the UI can explain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(backendEnhanceRequest({ text: 'hi', photoCount: 0 })).rejects.toMatchObject({ code: 'NetworkError' });
  });

  it('retries once on a gateway error for read-style calls, then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { text: 'better' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(backendEnhanceRequest({ text: 'hi', photoCount: 0 })).resolves.toBe('better');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a photo that fails analysis returns {} and never blocks the user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, { error: { name: 'Upstream500' } })));
    await expect(backendAnalyzePhoto({ src: 'data:image/png;base64,AA' })).resolves.toEqual({});
  });
});
