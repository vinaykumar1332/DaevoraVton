import { Readable } from 'node:stream';
import {
  checkCredentials, createToken, verifyToken, sessionFromReq, loginHandler, logoutHandler, sessionHandler, resetRateLimit, COOKIE,
} from '../../../api/_auth.js';

const USERS = [{ username: 'admin', password: 'pw-admin', role: 'admin', name: 'Admin' }, { username: 'demo', password: 'pw-demo' }];
const SECRET = 'x'.repeat(40);

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.end = (b) => ((res.body = b), res);
  res.json = () => JSON.parse(res.body);
  return res;
}
const mockReq = (method, body, headers = {}) =>
  Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, headers, socket: { remoteAddress: '1.2.3.4' } });

beforeEach(() => {
  process.env.APP_USERS = JSON.stringify(USERS);
  process.env.SESSION_SECRET = SECRET;
  resetRateLimit();
});
afterEach(() => {
  delete process.env.APP_USERS;
  delete process.env.SESSION_SECRET;
  vi.useRealTimers();
});

describe('credentials', () => {
  it('accepts a correct username and password and defaults the role', () => {
    expect(checkCredentials('admin', 'pw-admin')).toEqual({ username: 'admin', role: 'admin', name: 'Admin' });
    expect(checkCredentials(' demo ', 'pw-demo')).toEqual({ username: 'demo', role: 'viewer', name: 'demo' });
  });
  it('rejects wrong, empty and missing values', () => {
    expect(checkCredentials('admin', 'nope')).toBeNull();
    expect(checkCredentials('ghost', 'pw-admin')).toBeNull();
    expect(checkCredentials('', '')).toBeNull();
    expect(checkCredentials(undefined, undefined)).toBeNull();
  });
  it('ignores broken APP_USERS', () => {
    process.env.APP_USERS = 'not json';
    expect(checkCredentials('admin', 'pw-admin')).toBeNull();
  });
});

describe('session token', () => {
  const user = { username: 'admin', role: 'admin', name: 'Admin' };
  it('round-trips a valid token', () => expect(verifyToken(createToken(user))).toEqual(user));
  it('rejects a tampered token', () => {
    const [body, sig] = createToken(user).split('.');
    const forged = Buffer.from(JSON.stringify({ ...user, role: 'root', exp: Date.now() + 1e9 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyToken(`${body}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(verifyToken('garbage')).toBeNull();
    expect(verifyToken(undefined)).toBeNull();
  });
  it('rejects an expired token', () => {
    const token = createToken(user, Date.now() - 9 * 3600 * 1000);
    expect(verifyToken(token)).toBeNull();
  });
  it('rejects tokens signed with another secret, and everything when the secret is too short', () => {
    const token = createToken(user);
    process.env.SESSION_SECRET = 'y'.repeat(40);
    expect(verifyToken(token)).toBeNull();
    process.env.SESSION_SECRET = 'short';
    expect(verifyToken(token)).toBeNull();
  });
});

describe('handlers', () => {
  it('logs in, sets an HttpOnly SameSite cookie, and the cookie authenticates later requests', async () => {
    const res = mockRes();
    await loginHandler(mockReq('POST', { username: 'admin', password: 'pw-admin' }, { 'x-forwarded-proto': 'https' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('admin');
    const setCookie = res.headers['Set-Cookie'];
    expect(setCookie).toMatch(new RegExp(`^${COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Secure/);

    const cookieHeader = setCookie.split(';')[0];
    expect(sessionFromReq({ headers: { cookie: cookieHeader } }).username).toBe('admin');
    const sres = mockRes();
    await sessionHandler({ headers: { cookie: cookieHeader } }, sres);
    expect(sres.statusCode).toBe(200);
  });

  it('answers 401 for wrong credentials and no session', async () => {
    vi.useFakeTimers();
    const res = mockRes();
    const p = loginHandler(mockReq('POST', { username: 'admin', password: 'bad' }), res);
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(res.statusCode).toBe(401);
    expect(res.headers['Set-Cookie']).toBeUndefined();

    const sres = mockRes();
    await sessionHandler({ headers: {} }, sres);
    expect(sres.statusCode).toBe(200);
    expect(sres.json().user).toBeNull();
  });

  it('rate limits after 5 failed attempts, even with the right password afterwards', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      const p = loginHandler(mockReq('POST', { username: 'admin', password: 'bad' }), mockRes());
      await vi.advanceTimersByTimeAsync(500);
      await p;
    }
    const res = mockRes();
    await loginHandler(mockReq('POST', { username: 'admin', password: 'pw-admin' }), res);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
  });

  it('answers 503 naming the missing setting (never its value) when the server is not configured', async () => {
    const attempt = async () => {
      const r = mockRes();
      await loginHandler(mockReq('POST', { username: 'admin', password: 'pw-admin' }), r);
      return r;
    };
    delete process.env.SESSION_SECRET;
    let r = await attempt();
    expect(r.statusCode).toBe(503);
    expect(r.json().message).toMatch(/SESSION_SECRET is not set/);

    process.env.SESSION_SECRET = 'short';
    expect((await attempt()).json().message).toMatch(/at least 32/);

    process.env.SESSION_SECRET = SECRET;
    process.env.APP_USERS = '[{"username":"admin" "password":"pw"}]';
    r = await attempt();
    expect(r.json().message).toMatch(/not valid JSON/);
    expect(r.body).not.toMatch(/pw-admin|xxxx/);

    delete process.env.APP_USERS;
    expect((await attempt()).json().message).toMatch(/APP_USERS is not set/);
    process.env.APP_USERS = '{"not":"an array"}';
    expect((await attempt()).json().message).toMatch(/JSON array/);
    process.env.APP_USERS = JSON.stringify(USERS);
  });

  it('answers 405 for GET and 400 for bad JSON', async () => {

    process.env.SESSION_SECRET = SECRET;
    const b = mockRes();
    await loginHandler(mockReq('GET'), b);
    expect(b.statusCode).toBe(405);

    const c = mockRes();
    const bad = Object.assign(Readable.from([Buffer.from('{oops')]), { method: 'POST', headers: {}, socket: {} });
    await loginHandler(bad, c);
    expect(c.statusCode).toBe(400);
  });

  it('logout clears the cookie', async () => {
    const res = mockRes();
    await logoutHandler(mockReq('POST'), res);
    expect(res.headers['Set-Cookie']).toMatch(/Max-Age=0/);
  });
});
