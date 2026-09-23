import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bughunt S04: every player.py call spawned a Python process with no cap, so
// a flood of anonymous searches meant a flood of processes on the host. The
// fake children below stay alive until the test ends them, which is how the
// test counts how many run at once.

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  args: string[] = [];
  finish(stdout: string, code = 0) {
    this.stdout.emit('data', Buffer.from(stdout));
    this.emit('close', code);
  }
}

let alive: FakeChild[] = [];
let spawned = 0;
let peak = 0;

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: string[]) => {
    const child = new FakeChild();
    child.args = args;
    spawned += 1;
    alive.push(child);
    peak = Math.max(peak, alive.length);
    child.on('close', () => { alive = alive.filter((c) => c !== child); });
    return child;
  });
  return { spawn, default: { spawn } };
});

/** Let queued promise callbacks (and the semaphore handing out slots) run. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function finishAll(stdout: string) {
  for (const c of [...alive]) c.finish(stdout);
}

beforeEach(() => {
  vi.resetModules();
  alive = [];
  spawned = 0;
  peak = 0;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PYTHON_MAX_CONCURRENCY;
});

describe('runPython concurrency cap', () => {
  it('10 parallel searches run at most 4 Python processes at once', async () => {
    const { searchTracks } = await import('./youtube');
    const calls = Array.from({ length: 10 }, (_, i) => searchTracks(`song ${i}`));
    await settle();
    expect(spawned).toBe(4);

    // Each finished process lets exactly one queued search start.
    while (alive.length) {
      finishAll('[]');
      await settle();
    }
    await expect(Promise.all(calls)).resolves.toHaveLength(10);
    expect(spawned).toBe(10);
    expect(peak).toBe(4);
  });

  it('honours PYTHON_MAX_CONCURRENCY', async () => {
    process.env.PYTHON_MAX_CONCURRENCY = '2';
    const { searchTracks } = await import('./youtube');
    const calls = Array.from({ length: 5 }, (_, i) => searchTracks(`q ${i}`));
    await settle();
    expect(spawned).toBe(2);
    while (alive.length) {
      finishAll('[]');
      await settle();
    }
    await Promise.all(calls);
    expect(peak).toBe(2);
  });

  it('a failing process frees its slot', async () => {
    const { searchTracks } = await import('./youtube');
    const calls = Array.from({ length: 5 }, (_, i) => searchTracks(`bad ${i}`).catch((e: Error) => e));
    await settle();
    expect(spawned).toBe(4);
    for (const c of [...alive]) c.finish('', 1);
    await settle();
    expect(spawned).toBe(5);
    finishAll('[]');
    const results = await Promise.all(calls);
    expect(results.filter((r) => r instanceof Error)).toHaveLength(4);
  });

  it('a full queue fails cleanly with a 503 after the queue timeout', async () => {
    vi.useFakeTimers();
    const { searchTracks } = await import('./youtube');
    const held = Array.from({ length: 4 }, (_, i) => searchTracks(`held ${i}`));
    const queued = searchTracks('late').catch((e: Error & { status?: number }) => e);
    await settle();
    await vi.advanceTimersByTimeAsync(15_001);
    const err = (await queued) as Error & { status?: number };
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(503);
    expect(spawned).toBe(4);
    finishAll('[]');
    await Promise.all(held);
  });

  it('downloads go through the download gate only: 2 slow downloads do not block a search', async () => {
    // The download lane is lib/downloadGate (MAX_CONCURRENT_DOWNLOADS,
    // default 2). A download never also takes an interactive slot, so with
    // a single interactive slot a search still runs next to two downloads.
    process.env.PYTHON_MAX_CONCURRENCY = '1';
    const { ensureDownloaded, searchTracks } = await import('./youtube');
    const { downloadGate } = await import('@/lib/downloadGate');
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
    const downloads = ids.map((id) => ensureDownloaded(id));
    await settle();
    // Two run, the third waits for a gate slot.
    expect(alive.filter((c) => c.args.includes('download'))).toHaveLength(2);
    expect(downloadGate.inFlightCount()).toBe(2);
    expect(downloadGate.waitingCount()).toBe(1);

    const search = searchTracks('while downloading');
    await settle();
    const searchChild = alive.find((c) => c.args.includes('search'));
    expect(searchChild).toBeDefined();
    searchChild!.finish('[]');
    await expect(search).resolves.toEqual([]);

    while (alive.length) {
      for (const c of [...alive]) c.finish(JSON.stringify({ filePath: `/m/${c.args.at(-1)}.m4a` }));
      await settle();
    }
    await expect(Promise.all(downloads)).resolves.toHaveLength(3);
    expect(peak).toBe(3);
  });

  it('a download that waits too long for a gate slot fails with a 503', async () => {
    vi.useFakeTimers();
    const { ensureDownloaded } = await import('./youtube');
    const held = ['aaaaaaaaaaa', 'bbbbbbbbbbb'].map((id) => ensureDownloaded(id));
    const late = ensureDownloaded('ccccccccccc').catch((e: Error & { status?: number }) => e);
    await settle();
    await vi.advanceTimersByTimeAsync(60_001);
    const err = (await late) as Error & { status?: number };
    expect(err.status).toBe(503);
    expect(alive.filter((c) => c.args.includes('download'))).toHaveLength(2);
    for (const c of [...alive]) c.finish(JSON.stringify({ filePath: `/m/${c.args.at(-1)}.m4a` }));
    await Promise.all(held);
  });

  it('bulk import work (match, classify) cannot take the search slots', async () => {
    const { classifyVideos, searchMatchCandidates, searchTracks } = await import('./youtube');
    const bulk = [
      classifyVideos(['aaaaaaaaaaa']),
      classifyVideos(['bbbbbbbbbbb']),
      classifyVideos(['ccccccccccc']),
      searchMatchCandidates([{ title: 't', artist: 'a' }]),
    ].map((p) => p.catch(() => null));
    await settle();
    const search = searchTracks('during import');
    await settle();
    const searchChild = alive.find((c) => c.args.includes('search'));
    expect(searchChild).toBeDefined();
    searchChild!.finish('[]');
    await search;
    while (alive.length) {
      finishAll('{}');
      await settle();
    }
    await Promise.all(bulk);
  });
});
