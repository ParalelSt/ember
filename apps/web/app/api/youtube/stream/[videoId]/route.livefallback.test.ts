// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The reports (2026-11, Windows desktop and Android): "the host sent nothing
// for 25s (on a second attempt, after: the song stopped arriving while
// decoding (nothing for 3s))", "the host did not answer a request for more of
// the song while seeking to 25.7s (nothing for 25s)", and then "native audio
// failed, falling back to web audio", after pause, play and seek clicks.
//
// A song the host could not download (yt-dlp 403s, the usual sign of a stale
// yt-dlp) is relayed live from YouTube. That body is a fragmented mp4, which
// the desktop engine decodes forward-only, so every seek back, every pause
// that re-opens it and the engine's own retry is a NEW request to this route.
// And every one of those used to run yt-dlp again (or wait on the cache warm
// already running it) before it answered with a single byte: tens of seconds
// per request, against the engine's 25 s budget.
//
// Here the real route, the real lib/sources/youtube and the real memories run
// against a fake player.py and a fake googlevideo. Only the database, the
// session and the logger are stand-ins.

const LIVE_ID = 'livesong001';
const UPSTREAM = 'https://rr1.googlevideo.example/videoplayback';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

/** What the next `download` run does: fail with YouTube's 403, or hang the
 *  way a slow yt-dlp run does (closed by the test, or by afterEach). */
const fake = vi.hoisted(() => ({
  download: 'fail' as 'fail' | 'hang',
  runs: [] as string[][],
  hanging: [] as { emit: (event: string, ...args: unknown[]) => boolean }[],
}));
const downloads = () => fake.runs.filter((a) => a[0] === 'download').length;

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, argv: string[]) => {
    const args = argv.slice(1);
    fake.runs.push(args);
    const child = new FakeChild();
    const [command] = args;
    if (command === 'download' && fake.download === 'hang') {
      fake.hanging.push(child);
      return child;
    }
    queueMicrotask(() => {
      if (command === 'download') {
        child.stderr.emit('data', Buffer.from('ERROR: unable to download video data: HTTP Error 403: Forbidden\n'));
        child.emit('close', 1);
      } else if (command === 'info') {
        const expire = Math.floor(Date.now() / 1000) + 6 * 3600;
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          url: `${UPSTREAM}?expire=${expire}`,
          ext: 'm4a',
          httpHeaders: { 'User-Agent': 'yt-dlp-ua' },
        })));
        child.emit('close', 0);
      } else {
        child.stderr.emit('data', Buffer.from(`unexpected ${args.join(' ')}`));
        child.emit('close', 1);
      }
    });
    return child;
  });
  return { spawn, default: { spawn } };
});

vi.mock('@/lib/trackAvailability', () => ({
  markTrackUnavailable: vi.fn(),
  clearTrackUnavailable: vi.fn(),
  listUnavailableIds: async () => new Set(),
  freshUnavailableMark: async () => null,
}));
const logs = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: logs }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/streamCache', () => ({ queueCacheWarm: vi.fn() }));
vi.mock('@/lib/ytdlp/upgradeRunner', () => ({ noteYtdlpDownloadFailure: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  verifiedUserId: async () => 'member-1',
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

/** googlevideo: answers every request at once with an endless body, and
 *  remembers the ranges asked for and the bodies cancelled. */
const upstream = { ranges: [] as (string | null)[], cancelled: 0 };
function fakeGooglevideo(_url: string, init: RequestInit) {
  const range = new Headers(init.headers).get('range');
  upstream.ranges.push(range);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(16 * 1024));
    },
    cancel() {
      upstream.cancelled += 1;
    },
  });
  const start = Number(/^bytes=(\d+)-/.exec(range ?? '')?.[1] ?? 0);
  const total = 5_000_000;
  return Promise.resolve(new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'content-type': 'audio/mp4',
      ...(range ? { 'content-range': `bytes ${start}-${total - 1}/${total}` } : {}),
    },
  }));
}

// No song is ever on disk here.
process.env.MUSIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-live-'));

const { GET } = await import('./route');
const { ensureDownloaded, invalidateStreamUrl } = await import('@/lib/sources/youtube');
const { _resetFailureMemo, forgetUpgradeFixable, DOWNLOAD_FAILED_MEMO_MS, TRANSIENT_MEMO_MS } = await import('@/lib/sources/failureMemo');
const { _resetBuckets } = await import('@/lib/rateLimit');

async function stream(range: string | null, query = ''): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/youtube/stream/${LIVE_ID}${query}`, {
    headers: range ? { range } : {},
  });
  return GET(req, { params: Promise.resolve({ videoId: LIVE_ID }) } as never);
}

/** The route must answer (headers) inside `ms`, or the test fails the way
 *  the engine's request budget does. */
async function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the host sent nothing for ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The first play: the download fails, the song is relayed live. */
async function playLive() {
  const first = await within(2000, stream('bytes=0-'));
  expect(first.status).toBe(206);
  expect(downloads()).toBe(1);
  await first.body?.cancel();
  return first;
}

beforeEach(() => {
  fake.download = 'fail';
  fake.runs.length = 0;
  upstream.ranges.length = 0;
  upstream.cancelled = 0;
  logs.warn.mockClear();
  invalidateStreamUrl(LIVE_ID);
  _resetFailureMemo();
  _resetBuckets();
  vi.stubGlobal('fetch', vi.fn(fakeGooglevideo));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Let every hung yt-dlp run end, so its download slot and its place in the
  // in-flight list do not leak into the next test.
  for (const child of fake.hanging.splice(0)) {
    (child as unknown as FakeChild).stderr.emit('data', Buffer.from('ERROR: HTTP Error 403: Forbidden\n'));
    child.emit('close', 1);
  }
  await new Promise((r) => setTimeout(r, 0));
});

describe('a song the host is relaying live because its download failed', () => {
  it('is served live, and says so', async () => {
    const first = await playLive();
    expect(first.headers.get('x-ember-source')).toBe('live');
    expect(upstream.ranges).toEqual(['bytes=0-']);
  });

  it('a seek answers at once, without running yt-dlp again', async () => {
    await playLive();
    // The next yt-dlp run would be a slow one: nothing may wait on it.
    fake.download = 'hang';
    const seek = await within(1000, stream('bytes=1048576-'));
    expect(seek.status).toBe(206);
    expect(seek.headers.get('content-range')).toBe('bytes 1048576-4999999/5000000');
    expect(seek.headers.get('x-ember-source')).toBe('live');
    expect(downloads()).toBe(1);
    expect(upstream.ranges).toEqual(['bytes=0-', 'bytes=1048576-']);
    await seek.body?.cancel();
  });

  it("the engine's second attempt, a re-open after pause and seeks back all answer at once", async () => {
    await playLive();
    fake.download = 'hang';
    for (const range of ['bytes=0-', 'bytes=0-', 'bytes=300000-', 'bytes=0-']) {
      const res = await within(1000, stream(range));
      expect(res.status).toBe(206);
      await res.body?.cancel();
    }
    expect(downloads()).toBe(1);
  });

  it('a background download of the song in flight (the cache warm) does not hold a request up', async () => {
    await playLive();
    fake.download = 'hang';
    // What lib/streamCache does 90 s into a live play.
    const warm = ensureDownloaded(LIVE_ID).catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(downloads()).toBe(2);
    const seek = await within(1000, stream('bytes=2000000-'));
    expect(seek.status).toBe(206);
    expect(seek.headers.get('x-ember-source')).toBe('live');
    expect(downloads()).toBe(2);
    await seek.body?.cancel();
    void warm;
  });

  it('a listener who leaves a live response stops the host fetching it from YouTube', async () => {
    const res = await within(2000, stream('bytes=0-'));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(upstream.cancelled).toBe(1);
  });

  it('is tried again once the memory runs out', async () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await playLive();
    now.mockReturnValue(t0 + DOWNLOAD_FAILED_MEMO_MS + 1);
    const later = await within(2000, stream('bytes=0-'));
    expect(later.status).toBe(206);
    expect(downloads()).toBe(2);
  });

  it('is tried again after a yt-dlp upgrade', async () => {
    await playLive();
    forgetUpgradeFixable();
    const after = await within(2000, stream('bytes=0-'));
    expect(after.status).toBe(206);
    expect(downloads()).toBe(2);
  });

  it("the listener's own Tap to retry still gets a real download attempt", async () => {
    await playLive();
    const tapped = await within(2000, stream('bytes=0-', '?retry=1'));
    expect(tapped.status).toBe(206);
    expect(downloads()).toBe(2);
  });

  it('a relay YouTube stops serving is not kept from its download: the next real attempt runs yt-dlp', async () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await playLive();
    // The signed link goes bad: googlevideo refuses it, and a fresh one too.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    const refused = await within(2000, stream('bytes=0-'));
    expect(refused.status).toBe(502);
    expect(downloads()).toBe(1);
    // After the short "failed moments ago" memory, a full attempt again.
    now.mockReturnValue(t0 + TRANSIENT_MEMO_MS + 1);
    vi.stubGlobal('fetch', vi.fn(fakeGooglevideo));
    const later = await within(2000, stream('bytes=0-'));
    expect(later.status).toBe(206);
    expect(downloads()).toBe(2);
  });

  it('an answer that took seconds is logged on the host, with how it was served', async () => {
    await playLive();
    const t0 = Date.now();
    let calls = 0;
    // The first clock read is the request arriving; every later one is 6 s on.
    vi.spyOn(Date, 'now').mockImplementation(() => t0 + (calls++ === 0 ? 0 : 6_000));
    const res = await within(2000, stream('bytes=4096-'));
    expect(res.status).toBe(206);
    expect(logs.warn).toHaveBeenCalledWith('stream', 'slow to answer', expect.objectContaining({
      videoId: LIVE_ID,
      ms: 6_000,
      status: 206,
      source: 'live',
      range: 'bytes=4096-',
    }));
  });

  it('a save-to-disk request still asks yt-dlp: a live relay is not a file', async () => {
    await playLive();
    const save = await within(2000, stream(null, '?download=1'));
    expect(save.status).toBeGreaterThanOrEqual(400);
    expect(downloads()).toBe(2);
  });
});
