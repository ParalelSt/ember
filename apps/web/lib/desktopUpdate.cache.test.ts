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

const feed = { tag: 'v0.4.22', status: 200, calls: 0, gate: null as Promise<void> | null };
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async () => {
  feed.calls += 1;
  if (feed.gate) await feed.gate;
  if (feed.status !== 200) return new Response('nope', { status: feed.status });
  return Response.json([{ tag_name: feed.tag, draft: false, prerelease: false, assets: [] }]);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

const lib = await import('./desktopUpdate');

beforeEach(() => {
  vi.useRealTimers();
  lib._resetReleaseCache();
  feed.tag = 'v0.4.22';
  feed.status = 200;
  feed.calls = 0;
  feed.gate = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('latestRelease cache', () => {
  it('answers from memory while fresh', async () => {
    expect((await lib.latestRelease())?.tag_name).toBe('v0.4.22');
    expect((await lib.latestRelease())?.tag_name).toBe('v0.4.22');
    expect(feed.calls).toBe(1);
  });

  it('serves the stale copy at once and refreshes behind it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await lib.latestRelease();
    feed.tag = 'v0.4.23';
    vi.setSystemTime(Date.now() + 5_000);
    expect((await lib.latestRelease())?.tag_name).toBe('v0.4.22');
    await flush();
    await flush();
    expect(feed.calls).toBe(2);
    expect((await lib.latestRelease())?.tag_name).toBe('v0.4.23');
  });

  it('keeps the last good release when GitHub fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await lib.latestRelease();
    feed.status = 502;
    vi.setSystemTime(Date.now() + 5_000);
    await lib.latestRelease();
    await flush();
    await flush();
    expect((await lib.latestRelease())?.tag_name).toBe('v0.4.22');
  });

  it('callers arriving together share one request', async () => {
    let open!: () => void;
    feed.gate = new Promise<void>((r) => {
      open = r;
    });
    const all = Promise.all([lib.latestRelease(), lib.latestRelease(), lib.latestRelease()]);
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
    expect(await lib.latestReleaseWithin(50)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(500);
    open();
    await flush();
    await flush();
    expect((await lib.latestReleaseWithin(50))?.tag_name).toBe('v0.4.22');
    expect(feed.calls).toBe(1);
  });
});
