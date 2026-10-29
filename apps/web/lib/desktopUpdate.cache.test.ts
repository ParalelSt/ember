// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The release lookup every update feed shares, with its cache ON (the
// route tests turn it off to see every failure). Stale-while-revalidate: a
// launch is answered from memory while a fresh copy is fetched, a GitHub
// failure keeps the last good answer, and callers arriving together share
// one request.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '1000');
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const feed = {
  tag: 'v0.4.22',
  extra: [] as string[],
  status: 200,
  calls: 0,
  urls: [] as string[],
  gate: null as Promise<void> | null,
};
const realFetch = globalThis.fetch;
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  feed.calls += 1;
  feed.urls.push(String(input instanceof Request ? input.url : input));
  if (feed.gate) await feed.gate;
  if (feed.status !== 200) return new Response('nope', { status: feed.status });
  return Response.json([feed.tag, ...feed.extra].map((tag_name) => ({ tag_name, draft: false, prerelease: false, assets: [] })));
}) as typeof fetch;
globalThis.fetch = fetchMock;
afterAll(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

const lib = await import('./desktopUpdate');

beforeEach(() => {
  vi.useRealTimers();
  lib._resetReleaseCache();
  feed.tag = 'v0.4.22';
  feed.extra = [];
  feed.status = 200;
  feed.calls = 0;
  feed.urls = [];
  feed.gate = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('latestRelease cache', () => {
  it('answers from memory while fresh', async () => {
    expect((await lib.latestRelease('windows'))?.tag_name).toBe('v0.4.22');
    expect((await lib.latestRelease('windows'))?.tag_name).toBe('v0.4.22');
    expect(feed.calls).toBe(1);
  });

  it('serves the stale copy at once and refreshes behind it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await lib.latestRelease('windows');
    feed.tag = 'v0.4.23';
    vi.setSystemTime(Date.now() + 5_000);
    expect((await lib.latestRelease('windows'))?.tag_name).toBe('v0.4.22');
    await flush();
    await flush();
    expect(feed.calls).toBe(2);
    expect((await lib.latestRelease('windows'))?.tag_name).toBe('v0.4.23');
  });

  it('keeps the last good release when GitHub fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await lib.latestRelease('windows');
    feed.status = 502;
    vi.setSystemTime(Date.now() + 5_000);
    await lib.latestRelease('windows');
    await flush();
    await flush();
    expect((await lib.latestRelease('windows'))?.tag_name).toBe('v0.4.22');
  });

  it('callers arriving together share one request', async () => {
    let open!: () => void;
    feed.gate = new Promise<void>((r) => {
      open = r;
    });
    const all = Promise.all([lib.latestRelease('windows'), lib.latestRelease('windows'), lib.latestRelease('windows')]);
    open();
    const got = await all;
    expect(got.map((r) => r?.tag_name)).toEqual(['v0.4.22', 'v0.4.22', 'v0.4.22']);
    expect(feed.calls).toBe(1);
  });

  it('latestReleaseWithin gives up on a cold cache in time, and the lookup still warms it', async () => {
    let open!: () => void;
    feed.gate = new Promise<void>((r) => {
      open = r;
    });
    const started = Date.now();
    expect(await lib.latestReleaseWithin(50, 'windows')).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(500);
    open();
    await flush();
    await flush();
    expect((await lib.latestReleaseWithin(50, 'windows'))?.tag_name).toBe('v0.4.22');
    expect(feed.calls).toBe(1);
  });

  it('one request answers every platform, each with its own release', async () => {
    feed.extra = ['windows-v0.4.23', 'android-v0.4.24'];
    expect((await lib.latestRelease('windows'))?.tag_name).toBe('windows-v0.4.23');
    expect((await lib.latestRelease('android'))?.tag_name).toBe('android-v0.4.24');
    expect((await lib.latestRelease('macos'))?.tag_name).toBe('v0.4.22');
    expect((await lib.latestRelease('ios'))?.tag_name).toBe('v0.4.22');
    expect(feed.calls).toBe(1);
    expect(feed.urls[0]).toContain('per_page=30');
  });

  it('warmReleaseCache fills the list once for every platform', async () => {
    feed.extra = ['linux-v0.4.30'];
    lib.warmReleaseCache();
    await flush();
    await flush();
    expect(feed.calls).toBe(1);
    expect((await lib.latestRelease('linux'))?.tag_name).toBe('linux-v0.4.30');
    expect((await lib.latestRelease('windows'))?.tag_name).toBe('v0.4.22');
    expect(feed.calls).toBe(1);
  });

  it('a GitHub answer that is not a list reads as no release, not a crash', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ message: 'Bad credentials' })) as typeof fetch;
    try {
      expect(await lib.latestRelease('windows')).toBeNull();
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});
