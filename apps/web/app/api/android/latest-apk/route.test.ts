// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The short /apk download address: always the newest Android release's APK,
// public, under a file name a browser keeps.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '0');
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

type Rel = { tag_name: string; draft: boolean; prerelease: boolean; assets: { id: number; name: string; size: number }[] };
let releases: Rel[] = [];
const fullList: Rel[] = [
  { tag_name: 'android-v0.5.0', draft: true, prerelease: false, assets: [{ id: 501, name: 'Ember-v0.5.0-android.apk', size: 1 }] },
  { tag_name: 'android-v0.4.30', draft: false, prerelease: true, assets: [{ id: 430, name: 'Ember-v0.4.30-android.apk', size: 1 }] },
  { tag_name: 'windows-v0.4.29', draft: false, prerelease: false, assets: [{ id: 429, name: 'Ember-v0.4.29-windows-x64-setup.exe', size: 1 }] },
  {
    tag_name: 'android-v0.4.26', draft: false, prerelease: false,
    assets: [
      { id: 426, name: 'Ember-v0.4.26-android.apk', size: 7 },
      { id: 427, name: 'Ember-v0.4.26-android.aab', size: 1 },
    ],
  },
  { tag_name: 'android-v0.4.25', draft: false, prerelease: false, assets: [{ id: 425, name: 'Ember-v0.4.25-android.apk', size: 1 }] },
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
const { _resetReleaseCache } = await import('@/lib/desktopUpdate');

let seq = 0;
function get(ip?: string) {
  seq += 1;
  const req = new Request('http://localhost/apk', { headers: { 'x-forwarded-for': ip ?? `10.4.0.${seq}` } });
  return GET(req as never, {} as never);
}

beforeEach(() => {
  releases = fullList;
  assetFetches.length = 0;
  upstreamStatus = 200;
  _resetReleaseCache();
});

describe('GET /apk (/api/android/latest-apk)', () => {
  it('streams the newest published Android release apk as a named download', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Ember-0.4.26.apk"');
    expect(res.headers.get('content-length')).toBe('7');
    expect(await res.text()).toBe('APK-426');
    // Not the draft, the pre-release, another platform's release or an older one.
    expect(assetFetches).toEqual(['426']);
  });

  it('reads a legacy bare vX.Y.Z release too', async () => {
    releases = [{ tag_name: 'v0.4.19', draft: false, prerelease: false, assets: [{ id: 419, name: 'Ember-v0.4.19-android.apk', size: 7 }] }];
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Ember-0.4.19.apk"');
  });

  it('answers 404 when the newest release has no apk, without asking GitHub for a file', async () => {
    releases = [{ tag_name: 'android-v0.4.27', draft: false, prerelease: false, assets: [{ id: 1, name: 'notes.txt', size: 1 }] }];
    expect((await get()).status).toBe(404);
    expect(assetFetches).toEqual([]);
  });

  it('answers 404 when there is no release at all', async () => {
    releases = [];
    expect((await get()).status).toBe(404);
  });

  it('answers 404 when GitHub does not hand the file over', async () => {
    upstreamStatus = 502;
    expect((await get()).status).toBe(404);
  });

  it('rate limits one caller pulling the apk in a loop', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await get('10.8.8.8')).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
