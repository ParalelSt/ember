// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The phone updater's APK proxy. Public, so like the desktop asset proxy it
// serves exactly one file (the latest published release's APK) and refuses
// every other id before GitHub is asked.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '0');
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const releases = [
  { tag_name: 'v0.5.0', draft: true, prerelease: false, assets: [{ id: 501, name: 'Ember-v0.5.0-android.apk', size: 1 }] },
  {
    tag_name: 'v0.4.19', draft: false, prerelease: false,
    assets: [
      { id: 401, name: 'Ember-v0.4.19-android.apk', size: 7 },
      { id: 402, name: 'Ember-v0.4.19-macos-arm64.app.tar.gz', size: 1 },
      { id: 403, name: 'Ember-v0.4.19-macos-arm64.dmg', size: 1 },
    ],
  },
  { tag_name: 'v0.4.18', draft: false, prerelease: false, assets: [{ id: 301, name: 'Ember-v0.4.18-android.apk', size: 1 }] },
];

const assetFetches: string[] = [];
let upstreamStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/releases?')) return Response.json(releases);
  const m = /\/releases\/assets\/(\d+)$/.exec(url);
  if (m) {
    assetFetches.push(m[1]);
    if (upstreamStatus !== 200) return new Response('gone', { status: upstreamStatus });
    return new Response(`APK-${m[1]}`, { headers: { 'content-type': 'application/octet-stream', 'content-length': '7' } });
  }
  return new Response('unexpected', { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { GET } = await import('./route');

let seq = 0;
function get(id: string, ip?: string) {
  seq += 1;
  const req = new Request(`http://localhost/api/android/apk/${id}`, { headers: { 'x-forwarded-for': ip ?? `10.3.0.${seq}` } });
  return GET(req as never, { params: Promise.resolve({ id }) } as never);
}

beforeEach(() => {
  assetFetches.length = 0;
  upstreamStatus = 200;
});

describe('GET /api/android/apk/[id]', () => {
  it('streams the latest release apk as an Android package', async () => {
    const res = await get('401');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(res.headers.get('content-length')).toBe('7');
    expect(await res.text()).toBe('APK-401');
    expect(assetFetches).toEqual(['401']);
  });

  it.each([
    ['a desktop updater file of the latest release', '402'],
    ['a hand-download installer', '403'],
    ['an older release apk', '301'],
    ['a draft release apk', '501'],
    ['an id from nowhere', '999999'],
  ])('refuses %s without asking GitHub', async (_name, id) => {
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(assetFetches).toEqual([]);
  });

  it('answers 404 when GitHub does not hand the file over', async () => {
    upstreamStatus = 502;
    expect((await get('401')).status).toBe(404);
  });

  it('rejects a malformed id with 400', async () => {
    expect((await get('abc')).status).toBe(400);
    expect((await get('-1')).status).toBe(400);
    expect((await get('1.5')).status).toBe(400);
  });

  it('rate limits one caller pulling the apk in a loop', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await get('401', '10.9.9.9')).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
