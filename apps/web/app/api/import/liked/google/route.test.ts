// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { FAKE_ENV, FAKE_REFRESH, FAKE_USER_CODE, fakeGoogle, music, SECRET_MARK } from '@/test-utils/fakeGoogle';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';

// The four Google sign-in routes end to end, against a fake Google, with the
// real flow store and the real request logger; only the user, PocketBase and
// the runner are faked. Besides every state and every sentence, one promise
// is checked throughout: no token, device code or client secret ever comes
// back out, in a response or in anything written to the log.

let currentUser: { id: string } | null = { id: 'u1' };
class UnauthorizedError extends Error {}
vi.mock('@/lib/auth', () => ({
  requireUser: async () => {
    if (!currentUser) throw new UnauthorizedError('no');
    return { user: currentUser, pb: {} };
  },
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
const logged: unknown[] = [];
vi.mock('@/lib/logger/server', () => {
  const log = (...args: unknown[]) => void logged.push(args);
  return { serverLogger: { error: log, warn: log, info: log }, requestContext: { run: (_c: unknown, fn: () => unknown) => fn() } };
});
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: vi.fn(async () => ({ admin: true })),
  createClient: vi.fn(async () => ({ authStore: { record: currentUser } })),
}));
const kick = vi.fn();
vi.mock('@/lib/import/runnerInstance', () => ({ kickImportRunner: () => kick() }));
const newImports: Record<string, unknown>[] = [];
const createImportJob = vi.fn(async (_pb: unknown, n: Record<string, unknown>) => {
  newImports.push(n);
  return { job: { id: 'j1', kind: 'liked', source: 'ytmusic', total: (n.items as unknown[]).length }, playlistId: null };
});
vi.mock('@/lib/import/store', () => ({
  createImportJob: (pb: unknown, n: Record<string, unknown>) => createImportJob(pb, n),
}));

const collection = await import('./route');
const one = await import('./[flowId]/route');
const start = await import('./[flowId]/start/route');
const { _resetFlows, _flowStats } = await import('@/lib/import/google/flows');

const req = (method = 'GET') => ({ method, url: 'http://127.0.0.1/api/import/liked/google', headers: new Headers() }) as unknown as NextRequest;
const ctx = (flowId: string) => ({ params: Promise.resolve({ flowId }) });

/** Every body the routes answered with, so the last test can read them all. */
const bodies: string[] = [];
async function call(res: Response | Promise<Response>) {
  const r = await res;
  const text = await r.text();
  bodies.push(text);
  return { status: r.status, body: JSON.parse(text) as Record<string, never> };
}

const begin = () => call(collection.POST(req('POST'), {}));
const status = (flowId: string) => call(one.GET(req(), ctx(flowId)));
const cancel = (flowId: string) => call(one.DELETE(req('DELETE'), ctx(flowId)));
const startJob = (flowId: string) => call(start.POST(req('POST'), ctx(flowId)));

function useGoogle(opts: Parameters<typeof fakeGoogle>[0] = {}) {
  const g = fakeGoogle(opts);
  vi.stubGlobal('fetch', vi.fn(g.fetch));
  return g;
}
const pending = { error: 'authorization_pending', status: 428 };
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
  Object.assign(process.env, FAKE_ENV);
  vi.useFakeTimers();
  _resetFlows();
  currentUser = { id: `u-${Math.random().toString(36).slice(2)}` };
  logged.length = 0;
  newImports.length = 0;
  createImportJob.mockClear();
  kick.mockClear();
});
afterEach(() => {
  _resetFlows();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.env = savedEnv;
});

describe('GET /api/import/liked/google', () => {
  it('says whether this server can do a Google sign-in', async () => {
    expect((await call(collection.GET(req(), {}))).body).toEqual({ configured: true });
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect((await call(collection.GET(req(), {}))).body).toEqual({ configured: false });
  });

  it('needs a signed-in person', async () => {
    currentUser = null;
    expect((await call(collection.GET(req(), {}))).status).toBe(401);
    expect((await begin()).status).toBe(401);
    expect((await status('aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(401);
    expect((await startJob('aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(401);
    expect((await cancel('aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(401);
  });
});

describe('POST /api/import/liked/google', () => {
  it('hands back the code to type and a flow id, and nothing else', async () => {
    useGoogle();
    const { status: code, body } = await begin();
    expect(code).toBe(201);
    expect(Object.keys(body).sort()).toEqual(['expiresIn', 'flowId', 'interval', 'userCode', 'verificationUrl']);
    expect(body).toMatchObject({ userCode: FAKE_USER_CODE, verificationUrl: 'https://www.google.com/device', expiresIn: 900, interval: 5 });
  });

  it('a server with no Google client says so in one sentence, and asks Google nothing', async () => {
    const g = useGoogle();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const r = await begin();
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('This server is not set up for Google sign-in yet.');
    expect(g.requests).toHaveLength(0);
  });

  it("Google turning the server's setup down is a sentence for the host", async () => {
    useGoogle({ deviceError: { error: 'invalid_client', status: 401 } });
    const r = await begin();
    expect(r.status).toBe(503);
    expect(r.body.error).toBe(GOOGLE_MESSAGES.setupWrong);
  });

  it('ten sign-ins an hour per person, then a plain sentence', async () => {
    useGoogle({ polls: [pending] });
    for (let i = 0; i < 10; i++) expect((await begin()).status).toBe(201);
    const r = await begin();
    expect(r.status).toBe(429);
    expect(r.body.error).toBe(GOOGLE_MESSAGES.rateLimited);
  });
});

describe('GET /api/import/liked/google/:flowId, through every state', () => {
  it('waiting, then reading, then ready with the preview', async () => {
    const g = fakeGoogle({
      polls: [pending, 'token'],
      pages: [[music('aaaaaaaaaaa', 'First'), music('bbbbbbbbbbb', 'Vlog', 'Me', '22'), music('ccccccccccc', 'Second', 'Band - Topic', '24')]],
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/videos?')) await gate;
        return g.fetch(url, init);
      }),
    );
    const { body: started } = await begin();
    const flowId = started.flowId as string;
    expect((await status(flowId)).body).toEqual({ state: 'waiting' });
    await tick(5_000);
    expect((await status(flowId)).body).toEqual({ state: 'waiting' });
    await tick(5_000);
    expect((await status(flowId)).body).toEqual({ state: 'reading' });
    release();
    await tick(0);
    const ready = (await status(flowId)).body as unknown as { state: string; preview: Record<string, unknown> };
    expect(ready.state).toBe('ready');
    expect(ready.preview).toMatchObject({ count: 2, skipped: 1, label: 'Liked songs from YouTube Music', sample: [{ title: 'First' }, { title: 'Second' }] });
    expect(g.revoked).toEqual([FAKE_REFRESH]);
  });

  const endings: [string, Parameters<typeof fakeGoogle>[0], string, string][] = [
    ['denied', { polls: [{ error: 'access_denied', status: 403 }] }, 'denied', "You said no on Google's page, so nothing was read."],
    ['expired', { polls: [{ error: 'expired_token', status: 400 }] }, 'expired', 'The code ran out. Press Sign in with Google to get a new one.'],
    ['a read that fails', { videosError: { status: 403, reason: 'quotaExceeded' } }, 'error', GOOGLE_MESSAGES.quota],
  ];
  for (const [name, opts, state, message] of endings) {
    it(`${name}: { state: "${state}" } with its sentence`, async () => {
      useGoogle(opts);
      const { body } = await begin();
      await tick(5_000);
      expect((await status(body.flowId)).body).toEqual({ state, message });
    });
  }

  it('an unknown id, a malformed one and somebody else\'s all read as over', async () => {
    useGoogle();
    const { body } = await begin();
    for (const id of ['x'.repeat(24), '../../etc', 'short']) {
      const r = await status(id);
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ state: 'expired', message: GOOGLE_MESSAGES.gone });
    }
    currentUser = { id: 'someone-else' };
    expect((await status(body.flowId)).status).toBe(404);
  });
});

describe('POST /api/import/liked/google/:flowId/start', () => {
  it('creates the liked job exactly as the old account route did, items ready without a search', async () => {
    useGoogle({ pages: [[music('aaaaaaaaaaa', 'First'), music('bbbbbbbbbbb', 'Second')]] });
    const { body } = await begin();
    await tick(5_000);
    const r = await startJob(body.flowId);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ job: { id: 'j1' }, playlistId: null, truncated: false, note: null });
    expect(kick).toHaveBeenCalled();
    const [n] = newImports as { items: { title: string; candidates: { track: { sourceId: string }; score: number }[] }[] }[];
    expect(n).toMatchObject({ kind: 'liked', source: 'ytmusic', sourceId: 'ytmusic-liked', order: 'newest-first', name: 'Liked songs from YouTube Music' });
    expect(n.items.map((i) => i.title)).toEqual(['First', 'Second']);
    expect(n.items[0].candidates[0]).toMatchObject({ score: 100, track: { sourceId: 'aaaaaaaaaaa' } });
    // Once only: the sign-in is gone.
    expect((await startJob(body.flowId)).status).toBe(404);
    expect((await status(body.flowId)).status).toBe(404);
  });

  it('cannot start one that is still waiting, or somebody else\'s', async () => {
    useGoogle({ polls: [pending] });
    const { body } = await begin();
    const waiting = await startJob(body.flowId);
    expect(waiting.status).toBe(404);
    expect(waiting.body.error).toBe(GOOGLE_MESSAGES.gone);
    expect(createImportJob).not.toHaveBeenCalled();
  });

  it('says so when there were more likes than one transfer carries', async () => {
    // 201 pages of 50 different songs: 10 050, more than one transfer carries.
    const pages = Array.from({ length: 201 }, (_, p) =>
      Array.from({ length: 50 }, (_, i) => music(`p${String(p).padStart(4, '0')}${String(i).padStart(6, '0')}`, `Song ${p}.${i}`)),
    );
    useGoogle({ pages });
    const { body } = await begin();
    await tick(5_000);
    const r = await startJob(body.flowId);
    expect(r.status).toBe(201);
    expect(r.body.truncated).toBe(true);
    expect(String(r.body.note)).toContain('10,000');
    expect((newImports[0].items as unknown[]).length).toBe(10_000);
  });
});

describe('DELETE /api/import/liked/google/:flowId', () => {
  it('cancels a waiting sign-in: no more polling, nothing held', async () => {
    const g = useGoogle({ polls: [pending] });
    const { body } = await begin();
    await tick(5_000);
    expect((await cancel(body.flowId)).body).toEqual({ cancelled: true });
    const polls = g.polls;
    await tick(60_000);
    expect(g.polls).toBe(polls);
    expect(_flowStats()).toEqual({ flows: 0, holdingSecrets: 0 });
    expect((await status(body.flowId)).status).toBe(404);
  });

  it('cancelling mid-read revokes the token Google handed out', async () => {
    const g = fakeGoogle();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/videos?')) await new Promise(() => {});
        return g.fetch(url, init);
      }),
    );
    const { body } = await begin();
    await tick(5_000);
    expect((await status(body.flowId)).body).toEqual({ state: 'reading' });
    await cancel(body.flowId);
    expect(g.revoked).toEqual([FAKE_REFRESH]);
    expect(_flowStats()).toEqual({ flows: 0, holdingSecrets: 0 });
  });

  it('somebody else cannot cancel it', async () => {
    useGoogle({ polls: [pending] });
    const { body } = await begin();
    currentUser = { id: 'someone-else' };
    expect((await cancel(body.flowId)).body).toEqual({ cancelled: false });
  });
});

describe('the tokens never come back out', () => {
  it('not in any response or log line from any of the tests above, or from a full run here', async () => {
    useGoogle({ polls: [pending, 'token'], pages: [[music('aaaaaaaaaaa', 'First')]] });
    const { body } = await begin();
    await tick(10_000);
    await status(body.flowId);
    await startJob(body.flowId);
    const everything = bodies.join('\n') + JSON.stringify(logged);
    expect(bodies.length).toBeGreaterThan(20);
    expect(everything).not.toContain(SECRET_MARK);
    expect(everything).not.toMatch(/ya29\.|1\/\/0|AH-1N|GOCSPX/);
  });
});
