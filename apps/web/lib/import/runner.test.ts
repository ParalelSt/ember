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
import {
  BACKOFF_MS,
  MAX_PACE_MS,
  PACE_MS,
  YIELD_AFTER_BATCHES,
  countItems,
  type ItemStatus,
  type JobStatus,
} from '@/lib/import/jobState';
import type { ImportCandidate, MatchResult, SourceItem } from '@/lib/import/types';
import type { Track } from '@/types/track';
import type { TransferItem } from '@/lib/import/sources/types';
import { checkLikes, GOOGLE_LIKES_SOURCE_ID } from '@/lib/import/musicCheck';
import { musicFromPage } from '@/lib/import/google/likes';
import { parseYtmusicLiked } from '@/lib/import/sources/ytmusicLiked';
import { jobFromRecord } from '@/lib/import/records';
import { plainTransferResult } from '@/lib/import/transferCopy';
import { fakeYoutubeMusic, liked16, LIKED16_NOT_MUSIC, LIKED16_SONGS, LIKED16_UPLOADS } from '@/test-utils/fakeYoutubeMusic';

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

interface StoreOpts {
  ready?: boolean;
  status?: JobStatus;
  cursor?: number;
  /** A transfer: accepted songs are liked, not added to a playlist. */
  liked?: boolean;
  /** Songs the person had already liked, by video id. */
  alreadyLiked?: string[];
  /** Another job is waiting, so a transfer may step aside. */
  othersQueued?: boolean;
  /** The items a source handed over, some already decided (a Google like:
   *  an upload in review, or not music and skipped). */
  items?: TransferItem[];
}

function memoryStore(total: number, opts: StoreOpts = {}) {
  const job: Job = {
    id: 'j1',
    status: opts.status ?? 'queued',
    cursor: opts.cursor ?? 0,
    total,
    source: opts.ready ? 'ytmusic' : 'spotify',
    kind: opts.liked ? 'liked' : 'playlist',
    playlistId: opts.liked ? null : 'p1',
    userId: 'u1',
    existing: 0,
  };
  const items: Item[] = Array.from({ length: total }, (_, i) => ({
    id: `i${i}`,
    jobId: 'j1',
    position: i,
    source: opts.items ? opts.items[i] : source(i),
    candidates: opts.items ? (opts.items[i].candidates ?? []) : opts.ready ? [cand(`vid${i}`, 100)] : [],
    status: opts.items?.[i].status ?? 'pending',
    likedAt: opts.liked ? 1_700_000_000_000 - i * 1000 : null,
  }));
  const playlist: { position: number; track: Track }[] = [];
  const likes: { track: Track; likedAt: number | null }[] = [];
  const alreadyLiked = new Set(opts.alreadyLiked ?? []);
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
    like: vi.fn(async (_userId: string, t: Track, likedAt: number | null) => {
      // The (user, track) unique index: a song already liked is a no-op.
      if (alreadyLiked.has(t.sourceId) || likes.some((l) => l.track.id === t.id)) return { created: false, id: null };
      likes.push({ track: t, likedAt });
      return { created: true, id: `like-${t.sourceId}` };
    }),
    hasOtherQueued: vi.fn(async () => opts.othersQueued === true),
    counts: vi.fn(async () => countItems(items.map((i) => i.status))),
  };
  return { job, items, playlist, likes, patches, store };
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

// A transfer (kind: 'liked'): the same loop, but accepted songs become likes.
describe('ImportRunner, a transfer into the likes', () => {
  it('likes the accepted songs instead of adding them to a playlist', async () => {
    const m = memoryStore(20, { liked: true });
    const { r } = runner(m.store);
    await r.tick();
    expect(m.job.status).toBe('done');
    expect(m.playlist).toHaveLength(0);
    const accepted = m.items.filter((i) => i.status === 'accepted');
    expect(m.likes.map((l) => l.track.sourceId)).toEqual(accepted.map((i) => `vid${i.position}`));
    expect(m.store.addTrack).not.toHaveBeenCalled();
  });

  it('carries each song its own liked_at through to the like', async () => {
    const m = memoryStore(8, { liked: true });
    const { r } = runner(m.store);
    await r.tick();
    const first = m.items.find((i) => i.status === 'accepted')!;
    expect(m.likes[0].likedAt).toBe(1_700_000_000_000 - first.position * 1000);
    // Source order: every like is older than the one before it.
    expect(m.likes.every((l, k) => k === 0 || l.likedAt! < m.likes[k - 1].likedAt!)).toBe(true);
  });

  it('counts songs the person had already liked as existing, not as new', async () => {
    const m = memoryStore(20, { liked: true, alreadyLiked: ['vid0', 'vid3'] });
    const { r } = runner(m.store);
    await r.tick();
    expect(m.job.existing).toBe(2);
    expect(m.job.accepted).toBe(m.items.filter((i) => i.status === 'accepted').length);
    expect(m.likes.map((l) => l.track.sourceId)).not.toContain('vid0');
  });

  it('saves on each item the like it made, and none for a song already liked', async () => {
    const m = memoryStore(8, { liked: true, alreadyLiked: ['vid0'] });
    const { r } = runner(m.store);
    await r.tick();
    const saved = vi.mocked(m.store.saveResults).mock.calls.flatMap((c) => c[0]);
    const accepted = saved.filter((x) => x.status === 'accepted');
    expect(accepted.find((x) => x.position === 0)?.likeId).toBeNull();
    expect(accepted.find((x) => x.position === 1)?.likeId).toBe('like-vid1');
    expect(saved.filter((x) => x.status !== 'accepted').every((x) => !x.likeId)).toBe(true);
  });

  it('a playlist import never writes an existing count', async () => {
    const m = memoryStore(10);
    const { r } = runner(m.store);
    await r.tick();
    expect(m.patches.every((p) => p.existing === undefined)).toBe(true);
  });

  it('steps aside after ten batches when another job is waiting, keeping its cursor', async () => {
    const m = memoryStore(200, { liked: true, othersQueued: true });
    const match = vi.fn(fakeMatch);
    const { r } = runner(m.store, { match });
    await r.tick();

    // It hands itself back to the queue, lets go of the runner, and the
    // cursor says where to pick up. (The loop then claims the next queued
    // job, which in this store is the same one, so it runs on to the end.)
    const yielded = m.patches.filter((p) => p.status === 'queued');
    expect(yielded).toHaveLength(2);
    expect(yielded[0]).toMatchObject({ status: 'queued', heartbeat: null, runner: '' });
    const cursors = m.patches.filter((p) => p.cursor !== undefined).map((p) => p.cursor);
    expect(cursors[YIELD_AFTER_BATCHES - 1]).toBe(YIELD_AFTER_BATCHES * 8);
    // Nothing is matched twice: it carried on from the cursor each time.
    const seen = match.mock.calls.flatMap((c) => c[0].map((i) => i.position));
    expect(new Set(seen).size).toBe(seen.length);
    expect(m.job.status).toBe('done');
    expect(m.likes.length).toBeGreaterThan(0);
  });

  it('never steps aside when nothing else is waiting', async () => {
    const m = memoryStore(200, { liked: true });
    const { r } = runner(m.store);
    await r.tick();
    expect(m.job.status).toBe('done');
    expect(m.store.hasOtherQueued).toHaveBeenCalled();
  });

  it('a playlist import never steps aside, however long it is', async () => {
    const m = memoryStore(200, { othersQueued: true });
    const { r } = runner(m.store);
    await r.tick();
    expect(m.job.status).toBe('done');
    expect(m.store.hasOtherQueued).not.toHaveBeenCalled();
  });

  it('a cancel mid-transfer keeps the likes already made', async () => {
    const m = memoryStore(24, { liked: true });
    const match = vi.fn(async (items: SourceItem[]) => {
      if (items[0].position === 8) m.job.status = 'cancelled';
      return fakeMatch(items);
    });
    const { r } = runner(m.store, { match });
    await r.tick();
    expect(m.job.status).toBe('cancelled');
    expect(m.likes.length).toBeGreaterThan(0);
    // The batch in hand is finished before the cancel is noticed, so two
    // batches' worth of likes stand, and nothing after them.
    expect(m.likes.every((l) => Number(l.track.sourceId.replace('vid', '')) < 16)).toBe(true);
  });

  it('paces twice as slowly for the rest of a job that was told to slow down', async () => {
    const m = memoryStore(32);
    let calls = 0;
    const match = vi.fn(async (items: SourceItem[]) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('503'), { status: 503 });
      return fakeMatch(items);
    });
    const { r, sleeps } = runner(m.store, { match });
    await r.tick();
    expect(sleeps).toEqual([PACE_MS, BACKOFF_MS[0], PACE_MS * 2, PACE_MS * 2, PACE_MS * 2]);
    expect(PACE_MS * 2).toBeLessThanOrEqual(MAX_PACE_MS);
  });
});

// Two jobs in one queue, oldest first, the way claimNext sorts: a long
// transfer that started first and a playlist import that arrived after it.
describe('ImportRunner, a transfer and a playlist import in one queue', () => {
  function twoJobs() {
    const mk = (id: string, total: number, liked: boolean): Job => ({
      id,
      status: 'queued',
      cursor: 0,
      total,
      source: 'spotify',
      kind: liked ? 'liked' : 'playlist',
      playlistId: liked ? null : 'p1',
      userId: 'u1',
      existing: 0,
    });
    const jobs = [mk('transfer', 200, true), mk('playlist', 10, false)];
    const items: Item[] = jobs.flatMap((j) =>
      Array.from({ length: j.total }, (_, i) => ({
        id: `${j.id}-${i}`,
        jobId: j.id,
        position: i,
        source: source(i),
        candidates: [],
        status: 'pending' as ItemStatus,
        likedAt: null,
      })),
    );
    const finished: string[] = [];
    const byId = (id: string) => jobs.find((j) => j.id === id)!;
    const store: JobStore = {
      releaseStale: vi.fn(async () => 0),
      claimNext: vi.fn(async (runnerId: string, now: number, avoid?: string | null) => {
        const queued = jobs.filter((j) => j.status === 'queued');
        const next = queued.find((j) => j.id !== avoid) ?? queued[0];
        if (!next) return null;
        Object.assign(next, { status: 'running', runner: runnerId, heartbeat: now });
        return { ...next };
      }),
      getJob: vi.fn(async (id: string) => ({ ...byId(id) })),
      updateJob: vi.fn(async (id: string, patch: JobPatch) => {
        Object.assign(byId(id), patch);
        if (patch.status === 'done') finished.push(id);
      }),
      pendingItems: vi.fn(async (jobId: string, from: number, limit: number) =>
        items.filter((i) => i.jobId === jobId && i.status === 'pending' && i.position >= from).slice(0, limit),
      ),
      saveResults: vi.fn(async (results: ItemResult[]) => {
        for (const r of results) Object.assign(items.find((i) => i.id === r.itemId)!, { status: r.status });
      }),
      addTrack: vi.fn(async () => {}),
      like: vi.fn(async () => ({ created: true, id: null })),
      hasOtherQueued: vi.fn(async (jobId: string) => jobs.some((j) => j.id !== jobId && j.status === 'queued')),
      counts: vi.fn(async (jobId: string) => countItems(items.filter((i) => i.jobId === jobId).map((i) => i.status))),
    };
    return { jobs, items, finished, store };
  }

  it('the transfer steps aside after ten batches and the waiting import runs before it carries on', async () => {
    const q = twoJobs();
    const matched: string[] = [];
    const match = vi.fn(async (batch: SourceItem[]) => {
      const running = q.jobs.find((j) => j.status === 'running')!;
      matched.push(...batch.map((i) => `${running.id}:${i.position}`));
      return fakeMatch(batch);
    });
    const { r } = runner(q.store, { match });
    await r.tick();

    expect(q.finished).toEqual(['playlist', 'transfer']);
    // Ten batches of the transfer, then the whole playlist import, then the
    // rest of the transfer from its cursor.
    const firstPlaylist = matched.findIndex((m) => m.startsWith('playlist:'));
    expect(firstPlaylist).toBe(YIELD_AFTER_BATCHES * 8);
    expect(matched[firstPlaylist + 10]).toBe(`transfer:${YIELD_AFTER_BATCHES * 8}`);
    expect(q.jobs.every((j) => j.status === 'done')).toBe(true);
  });
});

// The owner's real transfer, which first brought a Minecraft video, a YTP and
// a satire ad into their Liked songs, and then (with every like read) all
// their YouTube videos into the preview. Their 16 likes, all filed under
// Music by the uploaders, with what YouTube Music's get_song said about each
// (tests/fixtures/imports/ytm-get-song-liked16.json), through the whole
// path: Google's page, both passes, the parser, the runner and the summary.
describe("ImportRunner, the owner's 16 real Google likes", () => {
  it('5 official songs liked, 5 uploads waiting for a look, 6 left out, and the sentence says so', async () => {
    const o = liked16();
    const ytm = fakeYoutubeMusic(o.answers);
    const first = musicFromPage(o.videos, new Set());
    expect(first.songs).toHaveLength(16);
    const checked = await checkLikes(first.songs, { classify: ytm.classify, sleep: async () => {}, live: () => true });
    const parsed = parseYtmusicLiked(checked!);

    const m = memoryStore(parsed.items.length, { liked: true, items: parsed.items });
    const match = vi.fn(fakeMatch);
    const { r, sleeps } = runner(m.store, { match });
    await r.tick();
    expect(m.job.status).toBe('done');
    // The runner searched nothing and asked nobody: YouTube Music had
    // already answered, before the preview.
    expect(match).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);

    const title = new Map(o.rows.map((row) => [row.videoId, row.title]));
    const titles = (st: ItemStatus) => m.items.filter((i) => i.status === st).map((i) => title.get(i.candidates[0].track.sourceId)).sort();
    expect(titles('accepted')).toEqual(LIKED16_SONGS);
    expect(titles('review')).toEqual(LIKED16_UPLOADS);
    expect(titles('skipped')).toEqual(LIKED16_NOT_MUSIC);
    // Only the official ones reach the likes.
    expect(m.likes.map((l) => title.get(l.track.sourceId)).sort()).toEqual(LIKED16_SONGS);

    const job = jobFromRecord({ ...m.job, source_id: GOOGLE_LIKES_SOURCE_ID });
    expect(job).toMatchObject({ accepted: 5, review: 5, missing: 0, notMusic: 6 });
    expect(plainTransferResult({ found: job.accepted, check: job.review, notFound: job.missing, notMusic: job.notMusic })).toBe(
      'We found 5 songs. 5 need a quick check. 6 likes were not music.',
    );
  });
});
