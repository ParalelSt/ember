import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTauriCacheAdapter, mapPrefetchOutcome, prefetchUrlFor } from './tauriAdapter';
import type { Track } from '@/types/track';

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.reject(new Error('no bridge in tests')) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const track = (id: string, streamUrl = `/api/youtube/stream/${id.split(':')[1]}`): Track => ({
  id,
  source: 'youtube',
  sourceId: id.split(':')[1] ?? id,
  title: 't',
  artist: 'a',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl,
});

/** A fake shell: records every call, answers from `answers`. */
function shell(answers: Record<string, (args?: Record<string, unknown>) => unknown> = {}) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  let keys: string[] = ['youtube:a'];
  const defaults: Record<string, (args?: Record<string, unknown>) => unknown> = {
    cache_keys: () => keys,
    cache_stats: () => ({ bytes: keys.length * 100, count: keys.length, cap: 524288000, maxFiles: 100 }),
    cache_prefetch: () => ({ kind: 'done', bytes: 100 }),
    cache_evict: (args) => {
      const gone = (args?.keys as string[]) ?? [];
      keys = keys.filter((k) => !gone.includes(k));
    },
    cache_clear: () => {
      keys = [];
    },
  };
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    const fn = answers[cmd] ?? defaults[cmd];
    return fn ? fn(args) : undefined;
  });
  return {
    calls,
    invoke: invoke as unknown as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    setKeys: (k: string[]) => {
      keys = k;
    },
  };
}

beforeEach(() => {
  document.cookie = 'pb_auth=tok; path=/';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('tauriCacheAdapter: an older or absent shell', () => {
  it('outside the desktop app it is unavailable and never calls the shell', async () => {
    const s = shell();
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => false });
    expect(await a.ready()).toBe(false);
    expect(a.kind).toBe('none');
    expect(s.calls).toEqual([]);
  });

  it('a desktop build without the cache commands reads as unavailable, and everything is a no-op', async () => {
    const s = shell({
      cache_keys: () => {
        throw new Error('Command cache_keys not allowed by ACL');
      },
    });
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });

    expect(await a.ready()).toBe(false);
    expect(a.kind).toBe('none');
    expect(a.has('youtube:a')).toBe(false);
    expect(a.localSrcFor('youtube:a')).toBeNull();
    const ctl = new AbortController();
    expect(await a.prefetch(track('youtube:b'), ctl.signal)).toEqual({ kind: 'failed' });
    a.touch('youtube:a');
    await a.evict(['youtube:a']);
    await a.clear();
    expect(s.calls.map((c) => c.cmd).filter((c) => c !== 'cache_keys' && c !== 'cache_stats')).toEqual([]);
  });

  it('a bridge that never answers gives up after the timeout instead of hanging', async () => {
    vi.useFakeTimers();
    const hang = () => new Promise(() => {});
    const a = createTauriCacheAdapter({
      invoke: hang as unknown as <T>(cmd: string) => Promise<T>,
      isTauri: () => true,
      readyTimeoutMs: 2000,
    });
    const ready = a.ready();
    await vi.advanceTimersByTimeAsync(2001);
    expect(await ready).toBe(false);
    expect(a.kind).toBe('none');
  });
});

describe('tauriCacheAdapter: a current shell', () => {
  it('is ready with the shell snapshot: kind, has, localSrcFor, stats, writesThrough', async () => {
    const s = shell();
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });

    expect(await a.ready()).toBe(true);
    expect(a.kind).toBe('tauri');
    expect(a.writesThrough).toBe(true);
    expect(a.has('youtube:a')).toBe(true);
    expect(a.has('youtube:b')).toBe(false);
    expect(a.localSrcFor('youtube:a')).toBe('cache:youtube:a');
    expect(a.localSrcFor('youtube:b')).toBeNull();
    expect(a.stats()).toEqual({ bytes: 100, count: 1, cap: 524288000 });
  });

  it('asks the shell once however often ready() is called', async () => {
    const s = shell();
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
    await Promise.all([a.ready(), a.ready()]);
    await a.ready();
    expect(s.calls.filter((c) => c.cmd === 'cache_keys')).toHaveLength(1);
  });

  it('prefetches the absolute stream URL with the prefetch marker, the track id and the session', async () => {
    const s = shell();
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
    await a.ready();
    s.setKeys(['youtube:a', 'youtube:b']);

    const out = await a.prefetch(track('youtube:b'), new AbortController().signal);

    expect(out).toEqual({ kind: 'done', bytes: 100 });
    const call = s.calls.find((c) => c.cmd === 'cache_prefetch');
    expect(call?.args).toEqual({
      url: `${window.location.origin}/api/youtube/stream/b?prefetch=1`,
      key: 'youtube:b',
      cookie: 'pb_auth=tok',
    });
    expect(a.has('youtube:b')).toBe(true);
    expect(a.stats().count).toBe(2);
  });

  it('maps the shell answers onto the policy results', async () => {
    for (const [raw, expected] of [
      [{ kind: 'retry-after', status: 429, seconds: 7 }, { kind: 'retry-after', status: 429, seconds: 7 }],
      [{ kind: 'retry-after', status: 503, seconds: null }, { kind: 'retry-after', status: 503, seconds: null }],
      [{ kind: 'gone' }, { kind: 'gone' }],
      [{ kind: 'failed', message: 'x' }, { kind: 'failed' }],
      [{ kind: 'busy' }, { kind: 'failed' }],
      [{ kind: 'cancelled' }, { kind: 'failed' }],
    ] as const) {
      const s = shell({ cache_prefetch: () => raw });
      const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
      await a.ready();
      expect(await a.prefetch(track('youtube:c'), new AbortController().signal)).toEqual(expected);
      expect(a.has('youtube:c')).toBe(false);
    }
  });

  it('a prefetch the shell rejects is a failure, not a throw', async () => {
    const s = shell({
      cache_prefetch: () => {
        throw new Error('boom');
      },
    });
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
    await a.ready();
    expect(await a.prefetch(track('youtube:c'), new AbortController().signal)).toEqual({ kind: 'failed' });
  });

  it('aborting the signal cancels the download in the shell', async () => {
    let finish: (v: unknown) => void = () => {};
    const s = shell({ cache_prefetch: () => new Promise((r) => (finish = r)) });
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
    await a.ready();
    const ctl = new AbortController();

    const run = a.prefetch(track('youtube:c'), ctl.signal);
    ctl.abort();
    finish({ kind: 'cancelled' });

    expect(await run).toEqual({ kind: 'failed' });
    expect(s.calls.map((c) => c.cmd)).toContain('cache_cancel');
  });

  it('an already aborted signal never starts a download', async () => {
    const s = shell();
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
    await a.ready();
    const ctl = new AbortController();
    ctl.abort();
    expect(await a.prefetch(track('youtube:c'), ctl.signal)).toEqual({ kind: 'failed' });
    expect(s.calls.map((c) => c.cmd)).not.toContain('cache_prefetch');
  });

  it('evict and clear update the snapshot', async () => {
    const s = shell();
    s.setKeys(['youtube:a', 'youtube:b']);
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
    await a.ready();

    await a.evict(['youtube:a']);
    expect(s.calls.find((c) => c.cmd === 'cache_evict')?.args).toEqual({ keys: ['youtube:a'] });
    expect(a.has('youtube:a')).toBe(false);
    expect(a.has('youtube:b')).toBe(true);

    await a.clear();
    expect(a.has('youtube:b')).toBe(false);
    expect(a.stats()).toEqual({ bytes: 0, count: 0, cap: 524288000 });
  });

  it('touch tells the shell only about cached songs', async () => {
    const s = shell();
    const a = createTauriCacheAdapter({ invoke: s.invoke, isTauri: () => true });
    await a.ready();
    a.touch('youtube:a');
    a.touch('youtube:zzz');
    expect(s.calls.filter((c) => c.cmd === 'cache_touch').map((c) => c.args)).toEqual([{ key: 'youtube:a' }]);
  });
});

describe('helpers', () => {
  it('prefetchUrlFor adds the marker to relative and absolute URLs alike', () => {
    expect(prefetchUrlFor('/api/youtube/stream/x')).toBe(`${window.location.origin}/api/youtube/stream/x?prefetch=1`);
    expect(prefetchUrlFor('https://h.example/api/uploads/u/stream?v=2')).toBe(
      'https://h.example/api/uploads/u/stream?v=2&prefetch=1',
    );
  });

  it('mapPrefetchOutcome refuses shapes it does not know', () => {
    expect(mapPrefetchOutcome(null)).toEqual({ kind: 'failed' });
    expect(mapPrefetchOutcome({ kind: 'done' })).toEqual({ kind: 'failed' });
    expect(mapPrefetchOutcome({ kind: 'retry-after', status: 500, seconds: 1 })).toEqual({ kind: 'failed' });
    expect(mapPrefetchOutcome({ kind: 'something-new' })).toEqual({ kind: 'failed' });
  });
});
