import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_CONCURRENCY,
  MusicCheckBusy,
  MusicCheckGaveUp,
  UPLOAD_REASON,
  checkLikes,
  likeOutcome,
  musicVideoType,
  notMusicCount,
  parseMusicCheck,
  songCandidate,
  type MusicCheck,
} from '@/lib/import/musicCheck';
import { BACKOFF_MS } from '@/lib/import/jobState';
import { likedSongFromVideo } from '@/lib/import/google/likes';
import type { LikedSong } from '@/lib/import/sources/ytmusicLiked';
import type { ImportCandidate } from '@/lib/import/types';
import { music } from '@/test-utils/fakeGoogle';
import { fakeYoutubeMusic, type FakeAnswer } from '@/test-utils/fakeYoutubeMusic';

const candidate = (over: Partial<ImportCandidate> = {}): ImportCandidate => ({
  track: {
    id: 'youtube:aaaaaaaaaaa',
    sourceId: 'aaaaaaaaaaa',
    source: 'youtube',
    title: 'Song',
    artist: 'Band',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: '/api/youtube/stream/aaaaaaaaaaa',
  },
  artists: ['Band'],
  videoType: null,
  explicit: null,
  score: 100,
  reasons: ['From your YouTube Music likes'],
  ...over,
});

describe('likeOutcome: what YouTube Music says decides', () => {
  it('official audio and official music videos are songs', () => {
    expect(likeOutcome('ATV')).toBe('accepted');
    expect(likeOutcome('OMV')).toBe('accepted');
  });

  it('an upload might be one: the person is asked', () => {
    expect(likeOutcome('UGC')).toBe('review');
  });

  it('no type at all is not music', () => {
    expect(likeOutcome(null)).toBe('skipped');
    expect(likeOutcome(undefined)).toBe('skipped');
  });
});

describe('musicVideoType', () => {
  it('knows the three types and nothing else', () => {
    expect(['ATV', 'OMV', 'UGC'].map(musicVideoType)).toEqual(['ATV', 'OMV', 'UGC']);
    for (const v of [null, undefined, '', 'atv', 'MUSIC_VIDEO_TYPE_ATV', 'PODCAST_EPISODE', 10, {}]) expect(musicVideoType(v)).toBeNull();
  });
});

describe('songCandidate', () => {
  it('fills in the type and keeps the reason', () => {
    const c = songCandidate(candidate(), 'OMV');
    expect(c.videoType).toBe('OMV');
    expect(c.reasons).toEqual(['From your YouTube Music likes']);
  });

  it('an upload says why it is being asked about, once', () => {
    const c = songCandidate(songCandidate(candidate(), 'UGC'), 'UGC');
    expect(c.reasons).toEqual(['From your YouTube Music likes', UPLOAD_REASON]);
  });
});

describe('parseMusicCheck', () => {
  it('answers for exactly the ids asked about', () => {
    const r = parseMusicCheck(
      { results: { aaaaaaaaaaa: 'ATV', bbbbbbbbbbb: 'UGC', ccccccccccc: null, zzzzzzzzzzz: 'OMV' }, failed: [], busy: false },
      ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'],
    );
    expect([...r.types]).toEqual([
      ['aaaaaaaaaaa', 'ATV'],
      ['bbbbbbbbbbb', 'UGC'],
      ['ccccccccccc', null],
    ]);
    expect(r.failed).toEqual([]);
  });

  it('a failed lookup, or an id the helper never mentioned, is null and listed', () => {
    const r = parseMusicCheck({ results: { aaaaaaaaaaa: null }, failed: ['aaaaaaaaaaa', 7] }, ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(r.types.get('aaaaaaaaaaa')).toBeNull();
    expect(r.types.get('bbbbbbbbbbb')).toBeNull();
    expect(r.failed).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });

  it('YouTube Music asking to slow down is a 503 the runner backs off on', () => {
    expect(() => parseMusicCheck({ busy: true, results: {} }, ['aaaaaaaaaaa'])).toThrow(MusicCheckBusy);
    expect(new MusicCheckBusy().status).toBe(503);
  });

  it('output with no results at all is an error too, so the batch is repeated rather than dropped', () => {
    expect(() => parseMusicCheck(null, ['aaaaaaaaaaa'])).toThrow();
    expect(() => parseMusicCheck({}, ['aaaaaaaaaaa'])).toThrow();
  });
});

describe('notMusicCount', () => {
  it('every item the transfer got through that did not become a song, a check or a miss', () => {
    expect(notMusicCount({ cursor: 16, accepted: 5, review: 5, missing: 0 })).toBe(6);
    // Stopped halfway: only what it got through counts.
    expect(notMusicCount({ cursor: 8, accepted: 3, review: 2, missing: 0 })).toBe(3);
    expect(notMusicCount({ cursor: 0, accepted: 0, review: 0, missing: 0 })).toBe(0);
  });
});

// The second pass, on its own: the flow hands it the likes the first pass
// kept and a classify that stands in for `player.py classify`.
describe('checkLikes', () => {
  /** `n` likes from ordinary channels, vid00000000 on, plus any extra. */
  const likes = (n: number, extra: LikedSong[] = []) => [
    ...Array.from({ length: n }, (_, i) => likedSongFromVideo(music(`vid${String(i).padStart(8, '0')}`, `Like ${i}`))!),
    ...extra,
  ];
  const typeOf = (i: number): FakeAnswer => (['ATV', 'OMV', 'UGC', null] as const)[i % 4];
  const answers = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`vid${String(i).padStart(8, '0')}`, typeOf(i)]));
  const deps = (classify: (ids: string[]) => Promise<MusicCheck>) => {
    const sleeps: number[] = [];
    const progress: [number, number][] = [];
    return {
      sleeps,
      progress,
      deps: {
        classify,
        sleep: vi.fn(async (ms: number) => void sleeps.push(ms)),
        live: () => true,
        onProgress: (d: number, t: number) => void progress.push([d, t]),
      },
    };
  };

  it('asks in batches of 8, at most three at once, and says how far it is', async () => {
    const ytm = fakeYoutubeMusic(answers(40), { gated: true });
    const d = deps(ytm.classify);
    const run = checkLikes(likes(40), d.deps);
    await vi.waitFor(() => expect(ytm.waiting).toBe(CHECK_CONCURRENCY));
    expect(d.progress).toEqual([[0, 40]]);
    // Let them go one by one: a new batch starts as each comes back.
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(ytm.waiting).toBeGreaterThan(0));
      ytm.release();
    }
    const out = (await run)!;
    expect(ytm.asked.map((b) => b.length)).toEqual([8, 8, 8, 8, 8]);
    expect(ytm.maxInFlight).toBe(3);
    expect(d.progress).toEqual([[0, 40], [8, 40], [16, 40], [24, 40], [32, 40], [40, 40]]);
    expect(out.map((s) => s.videoType)).toEqual(Array.from({ length: 40 }, (_, i) => typeOf(i)));
    // In the order given, not the order the batches came back.
    expect(out.map((s) => s.track.title)).toEqual(Array.from({ length: 40 }, (_, i) => `Like ${i}`));
  });

  it('a Topic channel is official audio already and is never asked about', async () => {
    const topic = likedSongFromVideo(music('topic000001', 'Nine Streets', 'The Quiet Parade - Topic', '24'))!;
    const ytm = fakeYoutubeMusic(answers(2));
    const out = (await checkLikes(likes(2, [topic]), deps(ytm.classify).deps))!;
    expect(ytm.asked).toEqual([['vid00000000', 'vid00000001']]);
    expect(out.map((s) => s.videoType)).toEqual(['ATV', 'OMV', 'ATV']);
  });

  it('nothing to ask about: no call at all', async () => {
    const topic = likedSongFromVideo(music('topic000001', 'Nine Streets', 'The Quiet Parade - Topic'))!;
    const classify = vi.fn();
    const d = deps(classify);
    expect((await checkLikes([topic], d.deps))!.map((s) => s.videoType)).toEqual(['ATV']);
    expect(classify).not.toHaveBeenCalled();
    expect(d.progress).toEqual([[0, 0]]);
  });

  it('one video whose lookup fails is left out, the rest of its batch is not', async () => {
    const ytm = fakeYoutubeMusic({ vid00000000: 'OMV', vid00000001: 'fail' });
    const log = vi.fn();
    const out = (await checkLikes(likes(2), { ...deps(ytm.classify).deps, log }))!;
    expect(out.map((s) => s.videoType)).toEqual(['OMV', null]);
    expect(log).toHaveBeenCalledWith('music check failed for a like, left out', { videoId: 'vid00000001' });
  });

  it('YouTube Music asking to slow down: waits, asks the same batch again, and carries on', async () => {
    const ytm = fakeYoutubeMusic({ vid00000000: ['busy', 'busy', 'ATV'], vid00000001: 'UGC' });
    const d = deps(ytm.classify);
    const out = (await checkLikes(likes(2), d.deps))!;
    expect(d.sleeps).toEqual([BACKOFF_MS[0], BACKOFF_MS[1]]);
    expect(ytm.asked).toHaveLength(3);
    expect(out.map((s) => s.videoType)).toEqual(['ATV', 'UGC']);
  });

  it('still no answer after every backoff: gives up rather than call songs "not music"', async () => {
    const ytm = fakeYoutubeMusic({ vid00000000: 'busy' });
    const d = deps(ytm.classify);
    await expect(checkLikes(likes(1), d.deps)).rejects.toBeInstanceOf(MusicCheckGaveUp);
    expect(d.sleeps).toEqual([...BACKOFF_MS]);
  });

  it('stops asking, and answers null, once the sign-in is over', async () => {
    const ytm = fakeYoutubeMusic(answers(40), { gated: true });
    let live = true;
    const run = checkLikes(likes(40), { ...deps(ytm.classify).deps, live: () => live });
    await vi.waitFor(() => expect(ytm.waiting).toBe(3));
    live = false;
    for (let i = 0; i < 3; i++) ytm.release();
    expect(await run).toBeNull();
    expect(ytm.asked).toHaveLength(3);
  });
});
