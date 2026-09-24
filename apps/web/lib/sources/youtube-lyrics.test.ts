// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Lyrics lookup (bughunt X9): LRCLib's search returns every version of a
// song (radio edit, live, extended), so synced lines must come from a hit
// whose length matches the track's, or the highlight runs ahead or behind.
// And a failed LRCLib call must not pin the Genius/none fallback in the
// hour-long cache: the next try should ask LRCLib again.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}
const pythonCalls: string[][] = [];
vi.mock('node:child_process', () => {
  const spawn = vi.fn((_bin: string, args: string[]) => {
    pythonCalls.push(args);
    const child = new FakeChild();
    setTimeout(() => {
      child.stdout.emit('data', JSON.stringify({ lyrics: 'plain words', source: 'genius', url: 'https://genius.test/x' }));
      child.emit('close', 0);
    }, 0);
    return child;
  });
  return { spawn, default: { spawn } };
});
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const lrclib = { mode: 'hits' as 'hits' | 'timeout' | 'down', hits: [] as unknown[] };
const lrclibUrls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (!url.startsWith('https://lrclib.net/')) throw new Error(`the test must not reach ${url}`);
  lrclibUrls.push(url);
  if (lrclib.mode === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (lrclib.mode === 'down') return new Response('bad gateway', { status: 502 });
  return new Response(JSON.stringify(lrclib.hits));
}) as typeof fetch;

const { getLyrics } = await import('./youtube');

const LIVE = { id: 1, duration: 305, plainLyrics: 'live words', syncedLyrics: '[00:10.00]live line' };
const STUDIO = { id: 2, duration: 214.4, plainLyrics: 'studio words', syncedLyrics: '[00:05.00]studio line' };

let n = 0;
/** A fresh title per test: the lyrics cache is module-wide. */
const title = () => `Song ${++n}`;

beforeEach(() => {
  lrclib.mode = 'hits';
  lrclib.hits = [];
  lrclibUrls.length = 0;
  pythonCalls.length = 0;
});

describe('getLyrics: the right version', () => {
  it('takes the synced lyrics whose length matches the track', async () => {
    lrclib.hits = [LIVE, STUDIO];
    const r = await getLyrics(title(), 'Band', 213);
    expect(r.source).toBe('lrclib');
    expect(r.synced?.[0]).toEqual({ time: 5, text: 'studio line' });
  });

  it('keeps words but drops timing when no version is within ~3 s', async () => {
    lrclib.hits = [LIVE];
    const r = await getLyrics(title(), 'Band', 213);
    expect(r.synced).toBeUndefined();
    expect(r.lyrics).toBe('live words');
  });

  it('still takes the first synced hit when the length is unknown', async () => {
    lrclib.hits = [LIVE, STUDIO];
    const r = await getLyrics(title(), 'Band');
    expect(r.synced?.[0]?.text).toBe('live line');
  });
});

describe('getLyrics: an LRCLib failure is not cached', () => {
  it('asks LRCLib again after a timeout', async () => {
    const t = title();
    lrclib.mode = 'timeout';
    const first = await getLyrics(t, 'Band', 214);
    expect(first.source).toBe('genius');
    lrclib.mode = 'hits';
    lrclib.hits = [STUDIO];
    const second = await getLyrics(t, 'Band', 214);
    expect(second.source).toBe('lrclib');
    expect(second.synced?.length).toBe(1);
  });

  it('asks LRCLib again after a server error', async () => {
    const t = title();
    lrclib.mode = 'down';
    await getLyrics(t, 'Band', 214);
    lrclib.mode = 'hits';
    lrclib.hits = [STUDIO];
    expect((await getLyrics(t, 'Band', 214)).source).toBe('lrclib');
  });

  it('still caches a real "LRCLib has nothing" answer', async () => {
    const t = title();
    lrclib.hits = [];
    await getLyrics(t, 'Band', 214);
    const calls = lrclibUrls.length;
    await getLyrics(t, 'Band', 214);
    expect(lrclibUrls.length).toBe(calls);
    expect(pythonCalls.length).toBe(1);
  });
});
