// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The launch gate's endpoint (every native shell asks it before opening).
// Fast, public, never 5xx: a broken check must open the app, not block it.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '0');
vi.stubEnv('PUBLIC_ORIGIN', 'https://ember.test');
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
const logged = vi.hoisted(() => ({ info: [] as unknown[][], error: [] as unknown[][] }));
vi.mock('@/lib/logger/server', () => ({
  serverLogger: {
    error: (...a: unknown[]) => logged.error.push(a),
    warn: vi.fn(),
    info: (...a: unknown[]) => logged.info.push(a),
  },
}));

type Asset = { id: number; name: string; size: number };
type Rel = { tag_name: string; draft: boolean; prerelease: boolean; body?: string; assets: Asset[] };

function release(tag: string, body = `Ember ${tag}`): Rel {
  const names = [
    `Ember-${tag}-windows-x64-setup.exe`,
    `Ember-${tag}-windows-x64-setup.exe.sig`,
    `Ember-${tag}-macos-arm64.app.tar.gz`,
    `Ember-${tag}-macos-arm64.app.tar.gz.sig`,
    `Ember-${tag}-linux-x86_64.AppImage`,
    `Ember-${tag}-linux-x86_64.AppImage.sig`,
    `Ember-${tag}-linux-amd64.deb`,
    `Ember-${tag}-android.apk`,
  ];
  return { tag_name: tag, draft: false, prerelease: false, body, assets: names.map((name, i) => ({ id: 500 + i, name, size: 1000 + i })) };
}

const feed = { releases: [] as Rel[], status: 200, throws: false, hangMs: 0, calls: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/releases?')) {
    feed.calls += 1;
    if (feed.hangMs) await new Promise((r) => setTimeout(r, feed.hangMs));
    if (feed.throws) throw new Error('network down');
    return feed.status === 200 ? Response.json(feed.releases) : new Response('nope', { status: feed.status });
  }
  return new Response('unexpected', { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { GET } = await import('./route');
const { _resetReleaseCache } = await import('@/lib/desktopUpdate');
const { _resetBuckets } = await import('@/lib/rateLimit');

function get(query: string, headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/app/update${query}`, { headers }) as never, undefined as never);
}

beforeEach(() => {
  feed.releases = [release('v0.4.22')];
  feed.status = 200;
  feed.throws = false;
  feed.hangMs = 0;
  feed.calls = 0;
  logged.info.length = 0;
  logged.error.length = 0;
  vi.unstubAllEnvs();
  vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
  vi.stubEnv('PUBLIC_ORIGIN', 'https://ember.test');
  _resetReleaseCache();
  _resetBuckets();
});

describe('GET /api/app/update', () => {
  it('offers a desktop shell the newer release to install', async () => {
    const res = await get('?platform=windows&version=0.4.21&arch=x86_64&install=nsis&launch=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      platform: 'windows',
      current: '0.4.21',
      latest: '0.4.22',
      minVersion: null,
      checkAfter: 21600,
      update: { version: '0.4.22', mandatory: false, reason: null, action: 'install', size: 1000, url: null },
    });
  });

  it('answers update: null when the shell is current', async () => {
    const body = await (await get('?platform=macos&version=0.4.22&install=app')).json();
    expect(body.update).toBeNull();
    expect(body.latest).toBe('0.4.22');
  });

  it('serves android and linux too', async () => {
    expect((await (await get('?platform=android&version=0.4.21&install=apk')).json()).update.action).toBe('install');
    expect((await (await get('?platform=linux&version=0.4.21&install=appimage')).json()).update.action).toBe('install');
  });

  it('turns an unsigned .deb into a download link through the server', async () => {
    const body = await (await get('?platform=linux&version=0.4.21&install=deb')).json();
    expect(body.update).toMatchObject({ action: 'download-page', url: 'https://ember.test/api/desktop/asset/506' });
  });

  it('reads mandatory and minVersion from the release notes, and strips them from the notes', async () => {
    feed.releases = [release('v0.4.22', 'Fixes a crash.\n\nmandatory: true\nminVersion: 0.4.20')];
    const body = await (await get('?platform=windows&version=0.4.19&install=nsis')).json();
    expect(body.minVersion).toBe('0.4.20');
    expect(body.update).toMatchObject({ mandatory: true, reason: 'min-version', notes: 'Fixes a crash.' });
  });

  it('EMBER_UPDATES_PAUSED makes it "no update" without asking GitHub', async () => {
    vi.stubEnv('EMBER_UPDATES_PAUSED', 'windows');
    const body = await (await get('?platform=windows&version=0.4.21&install=nsis')).json();
    expect(body).toMatchObject({ update: null, paused: true });
    expect((await (await get('?platform=macos&version=0.4.21&install=app')).json()).update).not.toBeNull();
  });

  it('GitHub down is update: null and unavailable, never 5xx', async () => {
    feed.status = 500;
    let res = await get('?platform=windows&version=0.4.21');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ update: null, unavailable: true });
    feed.status = 200;
    feed.throws = true;
    res = await get('?platform=windows&version=0.4.21');
    expect(res.status).toBe(200);
    expect((await res.json()).update).toBeNull();
  });

  it('a cold cache answers within the budget instead of waiting on GitHub', async () => {
    feed.hangMs = 3000;
    const started = Date.now();
    const body = await (await get('?platform=windows&version=0.4.21&launch=1')).json();
    const took = Date.now() - started;
    expect(took).toBeLessThan(800);
    expect(body).toMatchObject({ update: null, unavailable: true });
  });

  it('rejects a malformed platform or version with 400', async () => {
    for (const q of ['', '?platform=windows', '?version=0.4.21', '?platform=amiga&version=0.4.21', '?platform=windows&version=banana', '?platform=windows&version=1.2']) {
      expect((await get(q)).status, q).toBe(400);
    }
    expect(feed.calls).toBe(0);
  });

  it('ignores an unknown install kind or arch rather than failing', async () => {
    const body = await (await get('?platform=windows&version=0.4.21&install=floppy&arch=%3Cscript%3E')).json();
    expect(body.update.action).toBe('install');
  });

  it('rate limits one address at 120 an hour with a 429', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 120; i++) expect((await get('?platform=windows&version=0.4.22', headers)).status).toBe(200);
    const res = await get('?platform=windows&version=0.4.22', headers);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect((await get('?platform=windows&version=0.4.22', { 'x-forwarded-for': '203.0.113.10' })).status).toBe(200);
  });

  it('logs one update.check line per check', async () => {
    await get('?platform=android&version=0.4.21&install=apk&launch=1');
    const line = logged.info.find((a) => a[1] === 'update.check');
    expect(line?.[2]).toEqual({ platform: 'android', install: 'apk', current: '0.4.21', latest: '0.4.22', launch: true, result: 'update' });
  });
});
