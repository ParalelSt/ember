// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The phone app's update feed (AppUpdater.kt). Mirrors the desktop feed:
// the latest published release, its APK through the server's own proxy,
// 204 for "up to date" and for every failure.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '0');
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const DIGEST = 'ab'.repeat(32);
type Asset = { id: number; name: string; size: number; digest?: string };
type Rel = { tag_name: string; draft: boolean; prerelease: boolean; body?: string; published_at?: string; assets: Asset[] };

function release(tag: string, extra: Partial<Rel> = {}): Rel {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-10-01T10:00:00Z',
    body: `Ember ${tag}`,
    assets: [
      { id: 701, name: `Ember-${tag}-android.apk`, size: 18_000_000, digest: `sha256:${DIGEST}` },
      { id: 702, name: `Ember-${tag}-macos-arm64.dmg`, size: 1 },
    ],
    ...extra,
  };
}

const feed = { releases: [] as Rel[], status: 200, throws: false, calls: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/releases?')) {
    feed.calls += 1;
    if (feed.throws) throw new Error('network down');
    return feed.status === 200 ? Response.json(feed.releases) : new Response('nope', { status: feed.status });
  }
  return new Response('unexpected', { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { GET } = await import('./route');
const lib = await import('@/lib/androidUpdate');

function get(query: string) {
  return GET(new Request(`http://localhost/api/android/update${query}`) as never, undefined as never);
}

beforeEach(() => {
  feed.releases = [release('v0.4.19')];
  feed.status = 200;
  feed.throws = false;
  feed.calls = 0;
});

describe('GET /api/android/update', () => {
  it('offers the newer release with the proxied apk, size and sha256', async () => {
    const res = await get('?version=0.4.18&versionCode=23');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      version: '0.4.19',
      versionCode: null,
      url: '/api/android/apk/701',
      size: 18_000_000,
      sha256: DIGEST,
      publishedAt: '2026-10-01T10:00:00Z',
    });
    expect(body.url).not.toContain('github');
  });

  it('answers 204 when the phone already runs the latest version, or a newer one', async () => {
    expect((await get('?version=0.4.19')).status).toBe(204);
    expect((await get('?version=0.5.0')).status).toBe(204);
  });

  it('compares numerically, not as text (0.4.9 is older than 0.4.19)', async () => {
    expect((await get('?version=0.4.9')).status).toBe(200);
  });

  it('accepts a v prefix on the version', async () => {
    expect((await get('?version=v0.4.18')).status).toBe(200);
  });

  it('skips drafts and prereleases', async () => {
    feed.releases = [release('v0.5.0', { draft: true }), release('v0.4.30', { prerelease: true }), release('v0.4.19')];
    const body = await (await get('?version=0.4.18')).json();
    expect(body.version).toBe('0.4.19');
  });

  it('answers 204 when the latest release has no apk', async () => {
    feed.releases = [release('v0.4.19', { assets: [{ id: 9, name: 'Ember-v0.4.19-macos-arm64.dmg', size: 1 }] })];
    expect((await get('?version=0.4.18')).status).toBe(204);
  });

  it('reports no sha256 when GitHub gave no digest', async () => {
    feed.releases = [release('v0.4.19', { assets: [{ id: 701, name: 'Ember-v0.4.19-android.apk', size: 5 }] })];
    expect((await (await get('?version=0.4.18')).json()).sha256).toBeNull();
  });

  it('reads a versionCode the release notes state', async () => {
    feed.releases = [release('v0.4.19', { body: 'Fixes.\n\nversionCode: 24' })];
    expect((await (await get('?version=0.4.18')).json()).versionCode).toBe(24);
  });

  it('degrades every GitHub failure to 204', async () => {
    feed.status = 500;
    expect((await get('?version=0.4.18')).status).toBe(204);
    feed.status = 200;
    feed.throws = true;
    expect((await get('?version=0.4.18')).status).toBe(204);
  });

  it('rejects a missing or malformed version with 400', async () => {
    for (const q of ['', '?version=', '?version=banana', '?version=1.2', '?versionCode=23', '?version=1.2.3.4']) {
      expect((await get(q)).status, q).toBe(400);
    }
    expect(feed.calls).toBe(0);
  });
});

describe('androidUpdate helpers', () => {
  it('knows the apk name and nothing else', () => {
    expect(lib.isAndroidApkName('Ember-v0.4.19-android.apk')).toBe(true);
    for (const n of ['Ember-v0.4.19-android.apk.sig', 'Ember-v0.4.19-macos-arm64.dmg', 'evil.apk', 'Ember-v0.4.19-android.aab', 'x/Ember-v0.4.19-android.apk']) {
      expect(lib.isAndroidApkName(n), n).toBe(false);
    }
  });

  it('reads only a well-formed sha256 digest', () => {
    expect(lib.sha256Of({ digest: `sha256:${DIGEST.toUpperCase()}` })).toBe(DIGEST);
    expect(lib.sha256Of({ digest: 'sha1:abc' })).toBeNull();
    expect(lib.sha256Of({ digest: 'sha256:short' })).toBeNull();
    expect(lib.sha256Of({})).toBeNull();
  });

  it('cleans versions', () => {
    expect(lib.cleanVersion(' v0.04.18 ')).toBe('0.4.18');
    expect(lib.cleanVersion(null)).toBeNull();
    expect(lib.cleanVersion('0.4')).toBeNull();
  });
});
