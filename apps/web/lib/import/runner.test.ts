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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GOOGLE_LIKES_SOURCE_ID,
  UPLOAD_REASON,
  musicVideoType,
  notMusicCount,
  parseMusicCheck,
  type MusicCheck,
} from '@/lib/import/musicCheck';
import { likesFromPage } from '@/lib/import/google/likes';
import { parseYtmusicLiked } from '@/lib/import/sources/ytmusicLiked';
import { jobFromRecord } from '@/lib/import/records';
import { plainTransferResult } from '@/lib/import/transferCopy';

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
  /** Each item's ready candidates, by position (a Google likes transfer). */
  candidates?: (position: number) => ImportCandidate[];
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
    source: source(i),
    candidates: opts.candidates ? opts.candidates(i) : opts.ready ? [cand(`vid${i}`, 100)] : [],
    status: 'pending',
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
      for (const r of results) {
        Object.assign(items.find((i) => i.id === r.itemId)!, { status: r.status, videoId: r.videoId, candidates: r.candidates });
      }
    }),
    addTrack: vi.fn(async (_playlistId: string, position: number, t: Track) => {
      if (playlist.some((p) => p.track.id === t.id)) return;
      playlist.push({ position, track: t });
    }),
    like: vi.fn(async (_userId: string, t: Track, likedAt: number | null) => {
      // The (user, track) unique index: a song already liked is a no-op.
      if (alreadyLiked.has(t.sourceId) || likes.some((l) => l.track.id === t.id)) return { created: false };
      likes.push({ track: t, likedAt });
      return { created: true };
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

// A Google likes transfer: every like arrives with its video as the one
// candidate, marked for YouTube Music to say whether it is a song.
describe('ImportRunner, a Google likes transfer asks YouTube Music about each like', () => {
  const unchecked = (i: number): ImportCandidate[] => [{ ...cand(`vid${i}`, 100), videoType: null, reasons: ['From your YouTube Music likes'], unchecked: true }];
  /** ATV, OMV, UGC, nothing, by position. */
  const TYPES = ['ATV', 'OMV', 'UGC', null] as const;
  const fakeClassify = (answer: (id: string) => string | null = (id) => TYPES[Number(id.replace('vid', '')) % 4]) =>
    vi.fn(async (ids: string[]): Promise<MusicCheck> => ({ types: new Map(ids.map((id) => [id, musicVideoType(answer(id))])), failed: [] }));

  it('likes official audio and music videos, asks about uploads, leaves the rest out', async () => {
    const m = memoryStore(12, { liked: true, candidates: unchecked });
    const classify = fakeClassify();
    const match = vi.fn(fakeMatch);
    const { r, sleeps } = runner(m.store, { classify, match });
    await r.tick();
    expect(m.job.status).toBe('done');
    // One helper call per batch of 8, and never a search by name.
    expect(classify.mock.calls.map((c) => c[0].length)).toEqual([8, 4]);
    expect(match).not.toHaveBeenCalled();
    // Paced like searched batches: YouTube Music is asked either way.
    expect(sleeps).toEqual([PACE_MS, PACE_MS]);

    const byStatus = (st: ItemStatus) => m.items.filter((i) => i.status === st).map((i) => i.position);
    expect(byStatus('accepted')).toEqual([0, 1, 4, 5, 8, 9]);
    expect(byStatus('review')).toEqual([2, 6, 10]);
    expect(byStatus('skipped')).toEqual([3, 7, 11]);
    expect(m.likes.map((l) => l.track.sourceId)).toEqual(['vid0', 'vid1', 'vid4', 'vid5', 'vid8', 'vid9']);

    // The accepted ones say what they are; the check mark is gone.
    expect(m.items[0].candidates[0]).toMatchObject({ videoType: 'ATV' });
    expect(m.items[1].candidates[0]).toMatchObject({ videoType: 'OMV' });
    expect(m.items[0].videoId).toBe('vid0');
    // An upload waits for a yes or no, the video itself its one candidate.
    expect(m.items[2].videoId).toBeNull();
    expect(m.items[2].candidates).toHaveLength(1);
    expect(m.items[2].candidates[0]).toMatchObject({ videoType: 'UGC', track: { sourceId: 'vid2' } });
    expect(m.items[2].candidates[0].reasons).toContain(UPLOAD_REASON);
    expect(m.items.every((i) => i.candidates[0].unchecked === undefined)).toBe(true);

    expect({ accepted: m.job.accepted, review: m.job.review, missing: m.job.missing }).toEqual({ accepted: 6, review: 3, missing: 0 });
    expect(notMusicCount({ cursor: m.job.cursor, accepted: m.job.accepted ?? 0, review: m.job.review ?? 0, missing: m.job.missing ?? 0 })).toBe(3);
  });

  it('never asks about a like a Topic channel already vouched for', async () => {
    const m = memoryStore(4, {
      liked: true,
      candidates: (i) => (i % 2 ? [{ ...cand(`vid${i}`, 100), videoType: 'ATV' }] : unchecked(i)),
    });
    const classify = fakeClassify(() => null);
    const { r } = runner(m.store, { classify });
    await r.tick();
    expect(classify.mock.calls.map((c) => c[0])).toEqual([['vid0', 'vid2']]);
    expect(m.items.map((i) => i.status)).toEqual(['skipped', 'accepted', 'skipped', 'accepted']);
  });

  it('one video whose lookup failed is left out with a warning, and the job carries on', async () => {
    const m = memoryStore(3, { liked: true, candidates: unchecked });
    const classify = vi.fn(async (ids: string[]) =>
      parseMusicCheck({ results: { vid0: 'ATV', vid1: null, vid2: 'OMV' }, failed: ['vid1'], busy: false }, ids),
    );
    const log = vi.fn();
    const { r } = runner(m.store, { classify, log });
    await r.tick();
    expect(m.job.status).toBe('done');
    expect(m.items.map((i) => i.status)).toEqual(['accepted', 'skipped', 'accepted']);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/failed/), { job: 'j1', videoId: 'vid1' });
    expect(m.job.error ?? '').toBe('');
  });

  it('YouTube Music asking to slow down backs off and repeats the batch, like a search', async () => {
    const m = memoryStore(8, { liked: true, candidates: unchecked });
    let calls = 0;
    const classify = vi.fn(async (ids: string[]) => {
      calls += 1;
      return parseMusicCheck(calls === 1 ? { busy: true, results: {}, failed: [] } : { results: Object.fromEntries(ids.map((id) => [id, 'ATV'])) }, ids);
    });
    const { r, sleeps } = runner(m.store, { classify });
    await r.tick();
    expect(classify).toHaveBeenCalledTimes(2);
    expect(m.patches.some((p) => p.status === 'paused' && p.error === BUSY_MESSAGE)).toBe(true);
    expect(sleeps[0]).toBe(BACKOFF_MS[0]);
    expect(m.job.status).toBe('done');
    expect(m.likes).toHaveLength(8);
  });

  it('without the check wired in, a Google like is never liked blind', async () => {
    const m = memoryStore(2, { liked: true, candidates: unchecked });
    const { r } = runner(m.store, { backoffMs: [] });
    await r.tick();
    expect(m.likes).toHaveLength(0);
    expect(m.job.status).toBe('paused');
    expect(m.job.error).toBe(GAVE_UP_MESSAGE);
  });

  // The owner's real transfer, which brought a Minecraft video, a YTP and a
  // satire ad into their Liked songs. Their 16 likes, with what YouTube
  // Music's get_song said about each (tests/fixtures/imports/
  // ytm-get-song-liked16.json), through the whole path: Google's page,
  // the parser, the runner, and the summary.
  it("the owner's 16 real likes: 5 official songs liked, 5 uploads to check, 6 left out", async () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'imports', 'ytm-get-song-liked16.json'), 'utf8'),
    ) as { songs: { videoId: string; title: string; channel: string; musicVideoType: string | null }[] };
    const byId = new Map(fixture.songs.map((f) => [f.videoId, f]));
    // What the YouTube Data API hands over: every one of them says "Music".
    const page = fixture.songs.map((f) => ({
      id: f.videoId,
      snippet: { title: f.title, channelTitle: f.channel, categoryId: '10' },
      contentDetails: { duration: 'PT3M' },
    }));
    const parsed = parseYtmusicLiked(likesFromPage(page, new Set()));
    expect(parsed.items).toHaveLength(16);

    const m = memoryStore(16, { liked: true, candidates: (i) => parsed.items[i].candidates ?? [] });
    // player.py's own mapping: MUSIC_VIDEO_TYPE_ATV to ATV, and so on.
    const classify = vi.fn(async (ids: string[]) =>
      parseMusicCheck(
        { results: Object.fromEntries(ids.map((id) => [id, (byId.get(id)!.musicVideoType ?? '').replace('MUSIC_VIDEO_TYPE_', '') || null])) },
        ids,
      ),
    );
    const { r } = runner(m.store, { classify });
    await r.tick();
    expect(m.job.status).toBe('done');

    const titles = (st: ItemStatus) => m.items.filter((i) => i.status === st).map((i) => byId.get(i.candidates[0].track.sourceId)!.title);
    expect(titles('accepted').sort()).toEqual(['Ashes of the Dawn', 'Kradem Bakar', 'Uzalud Sunce Sja', 'Voices', 'ZITTI E BUONI']);
    expect(titles('review').sort()).toEqual([
      'Ali-A intro song',
      'Batzorig Vaanchig- Mongolian Throat Singing',
      'Chopin - Etude Op. 25 No. 11 (Winter Wind)',
      'NEW Bricks and Minifigs Commercial (satire)',
      'Welcome to American Fork!',
    ]);
    expect(titles('skipped').sort()).toEqual([
      'Eminem on TV Was Actually Insane',
      'How long it takes to learn drums #drums #drummers',
      'I Built a GIANT Mob Farm in Old Minecraft',
      '[YTP] dexter can\'t open the cargo box',
      'if you\'re reading this, i\'m in prison...',
      'ты слышал это в играх про гонки',
    ]);
    // Only the official ones reach the likes.
    expect(m.likes).toHaveLength(5);
    // The four Topic channels were known already; only the other 12 were asked about.
    expect(classify.mock.calls.flat().flat()).toHaveLength(12);

    // And the Liked page says so in plain words.
    const job = jobFromRecord({ ...m.job, source_id: GOOGLE_LIKES_SOURCE_ID });
    expect(job.notMusic).toBe(6);
    expect(plainTransferResult({ found: job.accepted, check: job.review, notFound: job.missing, notMusic: job.notMusic })).toBe(
      'We found 5 songs. 5 need a quick check. 6 likes were not music.',
    );
  });
});
