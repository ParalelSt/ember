/** The browser's auto cache in OPFS (opfsAdapter.ts) against an in-memory
 *  file system and a fake fetch: what lands on disk, how each server answer
 *  maps for the policy, the .part handling, and reconciling at boot. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test-utils/fakeBackend';
import { asHandle, FakeDir, FakeFile } from '@/test-utils/fakeOpfs';
import { CACHE_CAP_BYTES, createOpfsAdapter, fileNameFor, type OpfsAdapterDeps } from './opfsAdapter';
import { createAutoCacheDriver } from './driver';

vi.mock('@/lib/api', () => ({ apiUrl: (u: string) => `http://app${u}` }));

const A = makeTrack({ id: 'youtube:aaaaaaaaaaa', sourceId: 'aaaaaaaaaaa', streamUrl: '/api/youtube/stream/aaaaaaaaaaa', durationSec: 10 });
const B = makeTrack({ id: 'upload:b1', source: 'upload', sourceId: 'b1', streamUrl: '/api/uploads/b1/stream', durationSec: 10 });
const C = makeTrack({ id: 'upload:c1', source: 'upload', sourceId: 'c1', streamUrl: '/api/uploads/c1/stream', durationSec: 10 });

let root: FakeDir;
let clock: number;
let urlSeq: number;
const revoked: string[] = [];
const fetchMock = vi.fn();

const audio = (bytes: number, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes).fill(7), { status: 200, headers: { 'content-type': 'audio/mp4', ...headers } });

function adapter(extra: Partial<OpfsAdapterDeps> = {}) {
  return createOpfsAdapter({
    getRoot: async () => asHandle(root),
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock,
    estimate: async () => ({ quota: 10 * 1024 * 1024 * 1024 }),
    ...extra,
  });
}

const audioDir = () => root.dir('cache', 'audio');
const storedIndex = async () => {
  const f = root.dir('cache').children.get('index.json') as FakeFile | undefined;
  return f ? JSON.parse(await (await f.getFile()).text()) : null;
};
const signal = () => new AbortController().signal;

beforeEach(() => {
  root = new FakeDir();
  clock = 1_000;
  urlSeq = 0;
  revoked.length = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++urlSeq}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => audio(1000));
});

afterEach(() => vi.restoreAllMocks());

describe('opfsAdapter.ready', () => {
  it('is false where the browser has no OPFS', async () => {
    const a = createOpfsAdapter({ fetch: fetchMock as unknown as typeof fetch });
    expect(await a.ready()).toBe(false);
  });

  it('caps at 250 MB, or half the quota when that is smaller', async () => {
    const big = adapter();
    await big.ready();
    expect(big.stats().cap).toBe(CACHE_CAP_BYTES);
    const small = adapter({ estimate: async () => ({ quota: 100 * 1024 * 1024 }) });
    await small.ready();
    expect(small.stats().cap).toBe(50 * 1024 * 1024);
  });
});

describe('opfsAdapter.prefetch', () => {
  it('fetches the track own stream URL with ?prefetch=1 and stores it under its id', async () => {
    const a = adapter();
    await a.ready();
    const r = await a.prefetch(B, signal());

    expect(r).toEqual({ kind: 'done', bytes: 1000 });
    expect(fetchMock).toHaveBeenCalledWith('http://app/api/uploads/b1/stream?prefetch=1', expect.objectContaining({ credentials: 'include' }));
    expect(audioDir().names()).toEqual([fileNameFor(B.id)]);
    expect(a.has(B.id)).toBe(true);
    expect(a.localSrcFor(B.id)).toMatch(/^blob:/);
    expect(a.stats()).toMatchObject({ bytes: 1000, count: 1 });
    expect((await storedIndex()).entries[B.id]).toMatchObject({ bytes: 1000, mime: 'audio/mp4', lastUsedAt: 1000, addedAt: 1000 });
  });

  it('maps 429 and 503 with their Retry-After, 410 and other errors, and stores nothing', async () => {
    const a = adapter();
    await a.ready();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '7' } }));
    expect(await a.prefetch(A, signal())).toEqual({ kind: 'retry-after', status: 429, seconds: 7 });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect(await a.prefetch(A, signal())).toEqual({ kind: 'retry-after', status: 503, seconds: null });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 410 }));
    expect(await a.prefetch(A, signal())).toEqual({ kind: 'gone' });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
    expect(await a.prefetch(A, signal())).toEqual({ kind: 'failed' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await a.prefetch(A, signal())).toEqual({ kind: 'failed' });
    expect(a.has(A.id)).toBe(false);
    expect(audioDir().names()).toEqual([]);
  });

  it('never stores a sign-in page as audio', async () => {
    const a = adapter();
    await a.ready();
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await a.prefetch(A, signal())).toEqual({ kind: 'failed' });
    expect(a.has(A.id)).toBe(false);
  });

  it('a failed write leaves no .part and no entry', async () => {
    const a = adapter();
    await a.ready();
    audioDir().failWrites = true;
    expect(await a.prefetch(A, signal())).toEqual({ kind: 'failed' });
    expect(audioDir().names()).toEqual([]);
    expect(a.has(A.id)).toBe(false);
  });

  it('an aborted download leaves no .part and no entry', async () => {
    const a = adapter();
    await a.ready();
    const ac = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      ac.abort();
      return audio(500);
    });
    const r = await a.prefetch(A, ac.signal);
    expect(r.kind).toBe('failed');
    expect(audioDir().names()).toEqual([]);
    expect(a.has(A.id)).toBe(false);
  });

  it('copies the finished .part into place where move() is missing', async () => {
    const a = adapter();
    await a.ready();
    const move = FakeFile.prototype.move;
    // @ts-expect-error: simulate a browser without FileSystemFileHandle.move
    FakeFile.prototype.move = undefined;
    try {
      expect(await a.prefetch(A, signal())).toEqual({ kind: 'done', bytes: 1000 });
    } finally {
      FakeFile.prototype.move = move;
    }
    expect(audioDir().names()).toEqual([fileNameFor(A.id)]);
  });
});

describe('opfsAdapter at boot', () => {
  it('rebuilds from disk: entries, sizes and a blob: URL each', async () => {
    const first = adapter();
    await first.ready();
    await first.prefetch(A, signal());
    await first.prefetch(B, signal());

    const again = adapter();
    await again.ready();
    expect([...again.entries().keys()].sort()).toEqual([B.id, A.id].sort());
    expect(again.localSrcFor(A.id)).toMatch(/^blob:/);
    expect(again.stats()).toMatchObject({ bytes: 2000, count: 2 });
  });

  it('deletes stray .part files and files the index forgot, and drops entries whose file is gone', async () => {
    const first = adapter();
    await first.ready();
    await first.prefetch(A, signal());
    await first.prefetch(B, signal());
    audioDir().put(`${fileNameFor(C.id)}.part`, 'half');
    audioDir().put(fileNameFor('youtube:orphan00000'), 'orphan');
    await audioDir().removeEntry(fileNameFor(B.id));

    const again = adapter();
    await again.ready();
    expect(audioDir().names()).toEqual([fileNameFor(A.id)]);
    expect([...again.entries().keys()]).toEqual([A.id]);
    expect(Object.keys((await storedIndex()).entries)).toEqual([A.id]);
  });
});

describe('opfsAdapter touch, evict, clear', () => {
  it('touch bumps lastUsedAt and saves it', async () => {
    const a = adapter();
    await a.ready();
    await a.prefetch(A, signal());
    clock = 5_000;
    a.touch(A.id);
    a.touch('youtube:notcached00');
    expect(a.entries().get(A.id)?.lastUsedAt).toBe(5_000);
    await vi.waitFor(async () => expect((await storedIndex()).entries[A.id].lastUsedAt).toBe(5_000));
  });

  it('evict deletes the file and entry and revokes its URL', async () => {
    const a = adapter();
    await a.ready();
    await a.prefetch(A, signal());
    await a.prefetch(B, signal());
    const url = a.localSrcFor(A.id);
    await a.evict([A.id, 'youtube:unknown0000']);
    expect(a.has(A.id)).toBe(false);
    expect(a.localSrcFor(A.id)).toBeNull();
    expect(revoked).toContain(url);
    expect(audioDir().names()).toEqual([fileNameFor(B.id)]);
    expect(a.stats()).toMatchObject({ bytes: 1000, count: 1 });
  });

  it('clear empties the cache and leaves pinned downloads alone', async () => {
    root.put('keep.txt', 'x');
    const pinned = await root.getDirectoryHandle('playlists', { create: true });
    pinned.put('manifest.json', '{}');
    const a = adapter();
    await a.ready();
    await a.prefetch(A, signal());
    await a.clear();
    expect(a.stats()).toMatchObject({ bytes: 0, count: 0 });
    expect(audioDir().names()).toEqual([]);
    expect(root.dir('playlists').names()).toEqual(['manifest.json']);
  });
});

describe('opfsAdapter with the driver', () => {
  it('evicts the least recently used copy before a write that would pass the cap', async () => {
    // A cap of 2500 bytes: two 1000-byte songs fit, a third does not.
    const a = adapter({ estimate: async () => ({ quota: 5000 }) });
    await a.ready();
    const old = makeTrack({ id: 'upload:old', source: 'upload', streamUrl: '/api/uploads/old/stream', durationSec: 0 });
    await a.prefetch(old, signal());
    clock = 2_000;
    await a.prefetch(A, signal());
    clock = 3_000;

    // 0.05 s at the driver's 20 kB/s estimate: 1000 bytes expected, the real size.
    const tracks = [A, B, C].map((t) => ({ ...t, durationSec: 0.05 }));
    const driver = createAutoCacheDriver({
      adapter: a,
      player: () => ({ queue: tracks, index: 0, loopMode: 'off', context: null, baseCount: 3, playing: true }),
      playback: () => ({ playedSec: 60, bufferedToEnd: true }),
      conditions: () => ({ online: true, metered: false, saveData: false, batterySaver: false }),
      settings: () => ({ enabled: true, allowMetered: false }),
      now: () => clock,
    });
    driver.tick();
    await vi.waitFor(() => expect(a.has(B.id)).toBe(true));
    expect(a.stats().bytes).toBeLessThanOrEqual(2500);
    expect(a.has('upload:old')).toBe(false);
    // C does not fit without evicting the window, so it waits.
    await vi.waitFor(() => expect(driver.lastAction()).toEqual({ kind: 'idle', reason: 'cap' }));
    expect(a.has(C.id)).toBe(false);
    expect(a.has(A.id)).toBe(true);
    driver.dispose();
  });
});
