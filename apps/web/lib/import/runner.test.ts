import { describe, expect, it, vi } from 'vitest';
import {
  BUSY_MESSAGE,
  GAVE_UP_MESSAGE,
  ImportRunner,
  type ItemResult,
  type JobPatch,
  type JobStore,
  type PendingItem,
  type RunnerJob,
} from '@/lib/import/runner';
import { BACKOFF_MS, PACE_MS, countItems, type ItemStatus, type JobStatus } from '@/lib/import/jobState';
import type { ImportCandidate, MatchResult, SourceItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

// The runner against an in-memory PocketBase: jobs, items and the
// playlist's tracks are plain arrays, the matcher and the clock are fakes.

const track = (id: string): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title: id,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
});

const cand = (id: string, score: number): ImportCandidate => ({
  track: track(id),
  artists: ['A'],
  videoType: 'ATV',
  explicit: null,
  score,
  reasons: [],
});

const source = (position: number): SourceItem => ({
  position,
  title: `Song ${position}`,
  artists: ['A'],
  artist: 'A',
  durationMs: 200_000,
  explicit: null,
  uri: null,
});

interface Job extends RunnerJob {
  runner?: string;
  heartbeat?: number;
  retryAt?: number | null;
  error?: string;
  accepted?: number;
  review?: number;
  missing?: number;
}
interface Item extends PendingItem {
  status: ItemStatus;
  jobId: string;
  videoId?: string | null;
}

function memoryStore(total: number, opts: { ready?: boolean; status?: JobStatus; cursor?: number } = {}) {
  const job: Job = {
    id: 'j1',
    status: opts.status ?? 'queued',
    cursor: opts.cursor ?? 0,
    total,
    source: opts.ready ? 'ytmusic' : 'spotify',
    playlistId: 'p1',
  };
  const items: Item[] = Array.from({ length: total }, (_, i) => ({
    id: `i${i}`,
    jobId: 'j1',
    position: i,
    source: source(i),
    candidates: opts.ready ? [cand(`vid${i}`, 100)] : [],
    status: 'pending',
  }));
  const playlist: { position: number; track: Track }[] = [];
  const patches: JobPatch[] = [];
  const store: JobStore = {
    releaseStale: vi.fn(async (staleBefore: number) => {
      if (job.status === 'running' && (job.heartbeat ?? 0) < staleBefore) {
        job.status = 'queued';
        return 1;
      }
      return 0;
    }),
    claimNext: vi.fn(async (runnerId: string, now: number) => {
      if (job.status !== 'queued') return null;
      Object.assign(job, { status: 'running', runner: runnerId, heartbeat: now });
      return { ...job };
    }),
    getJob: vi.fn(async () => ({ ...job })),
    updateJob: vi.fn(async (_id: string, patch: JobPatch) => {
      patches.push(patch);
      Object.assign(job, patch);
    }),
    pendingItems: vi.fn(async (_jobId: string, from: number, limit: number) =>
      items.filter((i) => i.status === 'pending' && i.position >= from).slice(0, limit),
    ),
    saveResults: vi.fn(async (results: ItemResult[]) => {
      for (const r of results) Object.assign(items.find((i) => i.id === r.itemId)!, { status: r.status, videoId: r.videoId });
    }),
    addTrack: vi.fn(async (_playlistId: string, position: number, t: Track) => {
      if (playlist.some((p) => p.track.id === t.id)) return;
      playlist.push({ position, track: t });
    }),
    counts: vi.fn(async () => countItems(items.map((i) => i.status))),
  };
  return { job, items, playlist, patches, store };
}

/** Scores by position: every third song is unsure, every fifth not found. */
function fakeMatch(items: SourceItem[]): Promise<MatchResult[]> {
  return Promise.resolve(
    items.map((item) => {
      const p = item.position;
      const status = p % 5 === 4 ? 'missing' : p % 3 === 2 ? 'review' : 'accepted';
      const score = status === 'accepted' ? 90 : status === 'review' ? 60 : 30;
      return { item, status, confidence: score, candidates: [cand(`vid${p}`, score)] } as MatchResult;
    }),
  );
}

function runner(store: JobStore, over: Partial<ConstructorParameters<typeof ImportRunner>[0]> = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const r = new ImportRunner({
    store,
    match: vi.fn(fakeMatch),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    }),
    now: () => clock,
    runnerId: 'test-runner',
    ...over,
  });
  return { r, sleeps };
}

describe('ImportRunner', () => {
  it('runs a queued job to done, adding accepted tracks at their source positions', async () => {
    const m = memoryStore(20);
    const { r } = runner(m.store);
    await r.tick();
    expect(m.job.status).toBe('done');
    expect(m.job.cursor).toBe(20);
    const accepted = m.items.filter((i) => i.status === 'accepted').map((i) => i.position);
    expect(m.playlist.map((p) => p.position)).toEqual(accepted.map((p) => p + 1));
    expect({ accepted: m.job.accepted, review: m.job.review, missing: m.job.missing }).toEqual(countItems(m.items.map((i) => i.status)));
    expect(m.job.review).toBeGreaterThan(0);
    expect(m.job.missing).toBeGreaterThan(0);
  });

  it('matches in batches of 8 and moves the cursor after each', async () => {
    const m = memoryStore(20);
    const match = vi.fn(fakeMatch);
    const { r } = runner(m.store, { match });
    await r.tick();
    expect(match.mock.calls.map((c) => c[0].length)).toEqual([8, 8, 4]);
    expect(m.patches.filter((p) => p.cursor !== undefined).map((p) => p.cursor)).toEqual([8, 16, 20, 20]);
  });

  it('paces searched batches but not a YouTube playlist that needs no search', async () => {
    const spotify = memoryStore(20);
    const a = runner(spotify.store);
    await a.r.tick();
    expect(a.sleeps).toEqual([PACE_MS, PACE_MS, PACE_MS]);

    const yt = memoryStore(20, { ready: true });
    const match = vi.fn(fakeMatch);
    const b = runner(yt.store, { match });
    await b.r.tick();
    expect(match).not.toHaveBeenCalled();
    expect(b.sleeps).toEqual([]);
    expect(yt.playlist).toHaveLength(20);
    expect(yt.job.accepted).toBe(20);
  });

  it('resumes from the cursor after a restart, without adding anything twice', async () => {
    const m = memoryStore(20);
    // The first server dies after one batch: its job is left running.
    const dying = runner(m.store, {
      match: vi.fn(fakeMatch),
      sleep: vi.fn(async () => {
        throw new Error('server stopped');
      }),
    });
    await dying.r.tick();
    expect(m.job.cursor).toBe(8);
    m.job.status = 'running';
    m.job.heartbeat = 0;
    const before = m.playlist.length;

    const match = vi.fn(fakeMatch);
    const next = runner(m.store, { match });
    await next.r.tick();
    expect(m.store.releaseStale).toHaveBeenCalled();
    expect(m.job.status).toBe('done');
    // Only the rest was matched.
    expect(match.mock.calls.flatMap((c) => c[0].map((i) => i.position))).toEqual([...Array(12).keys()].map((i) => i + 8));
    expect(m.playlist.length).toBeGreaterThan(before);
    expect(new Set(m.playlist.map((p) => p.track.id)).size).toBe(m.playlist.length);
  });

  it('a 503 pauses with a retry time, waits 5 s, then carries on', async () => {
    const m = memoryStore(10);
    let calls = 0;
    const match = vi.fn(async (items: SourceItem[]) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('503'), { status: 503 });
      return fakeMatch(items);
    });
    const { r, sleeps } = runner(m.store, { match });
    await r.tick();
    const paused = m.patches.find((p) => p.status === 'paused');
    expect(paused).toMatchObject({ status: 'paused', error: BUSY_MESSAGE });
    expect(typeof paused?.retryAt).toBe('number');
    expect(sleeps[0]).toBe(BACKOFF_MS[0]);
    expect(m.patches.some((p) => p.status === 'running' && p.retryAt === null)).toBe(true);
    expect(m.job.status).toBe('done');
    expect(m.job.cursor).toBe(10);
  });

  it('backs off 5, 20, 60 s and then waits for Retry', async () => {
    const m = memoryStore(10);
    const match = vi.fn(async () => {
      throw new Error('503');
    });
    const { r, sleeps } = runner(m.store, { match });
    await r.tick();
    expect(sleeps).toEqual([...BACKOFF_MS]);
    expect(m.job.status).toBe('paused');
    expect(m.job.retryAt).toBeNull();
    expect(m.job.error).toBe(GAVE_UP_MESSAGE);
    expect(m.job.cursor).toBe(0);
    expect(match).toHaveBeenCalledTimes(4);

    // Retry: queued again, and this time YouTube answers.
    m.job.status = 'queued';
    const again = runner(m.store);
    await again.r.tick();
    expect(m.job.status).toBe('done');
  });

  it('stops when the job is cancelled mid-way', async () => {
    const m = memoryStore(24);
    const match = vi.fn(async (items: SourceItem[]) => {
      if (items[0].position === 8) m.job.status = 'cancelled';
      return fakeMatch(items);
    });
    const { r } = runner(m.store, { match });
    await r.tick();
    expect(m.job.status).toBe('cancelled');
    expect(match).toHaveBeenCalledTimes(2);
    expect(m.items.filter((i) => i.status === 'pending')).toHaveLength(8);
  });

  it('a cancel during a backoff wait is respected', async () => {
    const m = memoryStore(8);
    const match = vi.fn(async () => {
      throw new Error('503');
    });
    const { r } = runner(m.store, {
      match,
      sleep: vi.fn(async () => {
        m.job.status = 'cancelled';
      }),
    });
    await r.tick();
    expect(m.job.status).toBe('cancelled');
    expect(match).toHaveBeenCalledTimes(1);
  });

  it('marks the job failed when the store breaks', async () => {
    const m = memoryStore(8);
    m.store.addTrack = vi.fn(async () => {
      throw new Error('PocketBase is down');
    });
    const { r } = runner(m.store);
    await r.tick();
    expect(m.job.status).toBe('failed');
  });

  it('never runs two loops at once: a tick while busy only asks for another pass', async () => {
    const m = memoryStore(16);
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const match = vi.fn(async (items: SourceItem[]) => {
      await gate;
      return fakeMatch(items);
    });
    const { r } = runner(m.store, { match });
    const first = r.tick();
    await r.tick();
    await r.tick();
    expect(m.store.claimNext).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(m.job.status).toBe('done');
    // One more pass was asked for: it finds nothing queued.
    expect(m.store.claimNext).toHaveBeenCalledTimes(3);
    expect(match.mock.calls.every((c) => c[0].length <= 8)).toBe(true);
  });

  it('releases jobs whose heartbeat is older than the stale window', async () => {
    const m = memoryStore(4);
    const { r } = runner(m.store, { staleMs: 30_000 });
    await r.tick();
    expect(m.store.releaseStale).toHaveBeenCalledWith(1_000_000 - 30_000);
  });
});
