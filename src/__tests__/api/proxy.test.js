import { Readable } from 'node:stream';
import { makeProxy, FASHN_ALLOW, OPENAI_ALLOW } from '../../../api/_proxy.js';
import { createToken, COOKIE } from '../../../api/_auth.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.end = (b) => ((res.body = b), res);
  res.json = () => JSON.parse(res.body);
  return res;
}
const session = () => `${COOKIE}=${createToken({ username: 'admin', role: 'admin', name: 'Admin' })}`;
function req({ method = 'GET', query = {}, body, headers = {}, cookie = session() } = {}) {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(body)]), {
    method, query, headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}
const fashn = () => makeProxy({ origin: 'https://api.example.com', keyName: 'TEST_KEY', allow: FASHN_ALLOW });
const openai = () => makeProxy({ origin: 'https://api.openai.example', keyName: 'OPENAI_API_KEY', allow: OPENAI_ALLOW });

describe('API proxy', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.SESSION_SECRET = 'z'.repeat(40);
    process.env.TEST_KEY = 'secret';
    process.env.OPENAI_API_KEY = 'sk-test';
    // a fresh Response per call (a body can only be read once)
    global.fetch = vi.fn().mockImplementation(async () => new Response('{"id":"1"}', { status: 201, headers: { 'content-type': 'application/json' } }));
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.TEST_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SESSION_SECRET;
  });

  it('refuses requests without a valid session and never calls the upstream API', async () => {
    for (const cookie of [null, `${COOKIE}=garbage`]) {
      const res = mockRes();
      await fashn()(req({ cookie, query: { path: ['v1', 'credits'] } }), res);
      expect(res.statusCode).toBe(401);
      expect(res.headers['X-Session-Expired']).toBe('1');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('answers 500 with a clear message when the env key is missing', async () => {
    delete process.env.TEST_KEY;
    const res = mockRes();
    await fashn()(req({ query: { path: ['v1', 'credits'] } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toMatch(/TEST_KEY/);
  });

  it('forwards path, query and body and adds the bearer key', async () => {
    const res = mockRes();
    await fashn()(req({ method: 'POST', headers: { 'content-type': 'application/json' }, query: { path: ['v1', 'run'], x: '1' }, body: '{"a":1}' }), res);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/run?x=1');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(Buffer.from(init.body).toString()).toBe('{"a":1}');
    expect(res.statusCode).toBe(201);
  });

  it('accepts the path as one string, the way the vercel.json rewrite sends it', async () => {
    const res = mockRes();
    await fashn()(req({ query: { path: 'v1/status/abc-123' } }), res);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.example.com/v1/status/abc-123');
    expect(res.statusCode).toBe(201);

    const bad = mockRes();
    await fashn()(req({ query: { path: 'v1/status/../../admin' } }), bad);
    expect(bad.statusCode).toBe(403);
  });

  it('only forwards the endpoints the app uses', async () => {
    const calls = [
      ['GET', 'v1/credits', 200],
      ['GET', 'v1/status/abc-123', 200],
      ['GET', 'v1/agent/status/abc', 200],
      ['POST', 'v1/agent/images/run', 200],
      ['DELETE', 'v1/credits', 403], // wrong method
      ['GET', 'v1/account/keys', 403], // not allow-listed
      ['GET', 'v1/status/../keys', 403], // path tricks
      ['GET', 'v2/credits', 403],
    ];
    for (const [method, path, expected] of calls) {
      const res = mockRes();
      await fashn()(req({ method, query: { path: path.split('/') }, body: method === 'POST' ? '{}' : undefined }), res);
      expect([method, path, res.statusCode]).toEqual([method, path, expected === 200 ? 201 : expected]);
    }
  });

  it('limits OpenAI chat to the models the app uses and passes multipart edits through', async () => {
    const json = { 'content-type': 'application/json' };
    const bad = mockRes();
    await openai()(req({ method: 'POST', headers: json, query: { path: ['v1', 'chat', 'completions'] }, body: '{"model":"o3-pro"}' }), bad);
    expect(bad.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();

    const ok = mockRes();
    await openai()(req({ method: 'POST', headers: json, query: { path: ['v1', 'chat', 'completions'] }, body: '{"model":"gpt-4o"}' }), ok);
    expect(ok.statusCode).toBe(201);

    const edit = mockRes();
    await openai()(req({ method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, query: { path: ['v1', 'images', 'edits'] }, body: '--x--' }), edit);
    expect(edit.statusCode).toBe(201);
    expect(global.fetch.mock.calls[1][1].headers['Content-Type']).toBe('multipart/form-data; boundary=x');

    const other = mockRes();
    await openai()(req({ method: 'POST', headers: json, query: { path: ['v1', 'files'] }, body: '{}' }), other);
    expect(other.statusCode).toBe(403);
  });

  it('rejects an invalid JSON body and an oversized body', async () => {
    const res = mockRes();
    await openai()(req({ method: 'POST', headers: { 'content-type': 'application/json' }, query: { path: ['v1', 'chat', 'completions'] }, body: '{oops' }), res);
    expect(res.statusCode).toBe(400);

    const big = mockRes();
    await fashn()(req({ method: 'POST', query: { path: ['v1', 'run'] }, body: 'x'.repeat(4.6 * 1024 * 1024) }), big);
    expect(big.statusCode).toBe(413);
  });

  it('returns 502 without leaking details when the upstream is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND secret-internal-host'));
    const res = mockRes();
    await fashn()(req({ query: { path: ['v1', 'credits'] } }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toMatch(/secret-internal-host/);
  });
});
