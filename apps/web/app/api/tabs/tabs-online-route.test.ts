// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { UnauthorizedError } from '@/lib/auth';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

// POST /api/tabs/online (look for a song's tab on Ultimate Guitar) with a
// fake admin client and the fixture site standing in for UG: one search
// per song, the stored rows are served by the download route, "again", and
// failures stay quiet. MUSIC_DIR and UG_BASE are read when the libs load.
const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-online-route-test-'));
process.env.MUSIC_DIR = musicDir;
process.env.UG_BASE = 'http://ug.test';
process.env.TAB_FETCH_GAP_MS = '0';

const FIXTURES = path.resolve(__dirname, '../../../../../tests/fixtures/ug');
const urls: string[] = [];
let answer: number | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  urls.push(url);
  if (!url.startsWith('http://ug.test/')) throw new Error(`the test must not reach ${url}`);
  if (answer) return new Response('no', { status: answer });
  if (url.includes('/search.php')) {
    const empty = url.includes('Nothing');
    return new Response(fs.readFileSync(path.join(FIXTURES, empty ? 'search-empty.html' : 'search.html'), 'utf8'));
  }
  const id = /-(\d+)$/.exec(new URL(url).pathname)?.[1];
  const file = path.join(FIXTURES, `tab-${id}.html`);
  return fs.existsSync(file) ? new Response(fs.readFileSync(file, 'utf8')) : new Response('gone', { status: 404 });
}) as typeof fetch;

const requireUser = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});
let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));

const online = await import('./online/route');
const download = await import('./files/[id]/download/route');
const { resetOnline } = await import('@/lib/tabFetch/online');
const { resetBackfill } = await import('@/lib/tabStore');

let n = 0;
const member = () => ({ id: `m${++n}`, email: `m${n}@x`, isAdmin: false });
const as = (u: ReturnType<typeof member> | null) =>
  u ? requireUser.mockResolvedValue({ user: u }) : requireUser.mockRejectedValue(new UnauthorizedError());
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const post = (body: unknown) =>
  online.POST(req('/api/tabs/online', { method: 'POST', body: JSON.stringify(body) }), undefined as never);
const SONG = { title: 'Harbour Lights', artist: 'The Lantern Keepers', trackId: 'youtube:abc' };

beforeEach(() => {
  store = fakePocketBase({ tabs: [], tab_lookups: [], users: [] });
  resetOnline();
  resetBackfill();
  requireUser.mockReset();
  urls.length = 0;
  answer = null;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(musicDir, { recursive: true, force: true });
});

describe('POST /api/tabs/online', () => {
  it('needs a member and a title', async () => {
    as(null);
    expect((await post(SONG)).status).toBe(401);
    as(member());
    expect((await post({ ...SONG, title: '' })).status).toBe(400);
    expect(urls).toHaveLength(0);
  });

  it('finds the tabs once, stores them where the download route serves them', async () => {
    as(member());
    const res = await post(SONG);
    expect(await res.json()).toMatchObject({ status: 'found', added: 2 });
    expect(urls[0]).toMatch(/^http:\/\/ug\.test\/search\.php\?/);
    expect(urls.slice(1)).toEqual([
      'http://ug.test/tab/the-lantern-keepers/harbour-lights-tabs-9100001',
      'http://ug.test/tab/the-lantern-keepers/harbour-lights-bass-9100011',
    ]);
    const row = store.rows.get('tabs')![0];
    expect(fs.existsSync(path.join(musicDir, 'tabs', 'fetched', String(row.file)))).toBe(true);
    const dl = await download.GET(req(`/api/tabs/files/${row.id}/download`), { params: Promise.resolve({ id: row.id }) } as never);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toContain('\\tempo 100');

    // Another member opening the song: answered from the store.
    as(member());
    expect(await (await post(SONG)).json()).toMatchObject({ status: 'cached', added: 0 });
    expect(urls).toHaveLength(3);
  });

  it('"again" searches anew', async () => {
    as(member());
    await post(SONG);
    expect(await (await post({ ...SONG, again: true })).json()).toMatchObject({ status: 'found', added: 0 });
    expect(urls).toHaveLength(4);
  });

  it('"again" has its own budget per member', async () => {
    const m = member();
    as(m);
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) last = await post({ ...SONG, title: `Nothing ${i}`, again: true });
    expect(last!.status).toBe(429);
  });

  it('a site saying slow down is quiet: 200 with failed, nothing stored', async () => {
    as(member());
    answer = 429;
    const res = await post(SONG);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'failed', added: 0 });
    expect(store.rows.get('tab_lookups')).toHaveLength(0);
  });
});
