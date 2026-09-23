import { describe, expect, it } from 'vitest';
import {
  MusicCheckBusy,
  UPLOAD_REASON,
  checkedCandidate,
  likeOutcome,
  musicVideoType,
  needsMusicCheck,
  notMusicCount,
  parseMusicCheck,
} from '@/lib/import/musicCheck';
import type { ImportCandidate } from '@/lib/import/types';

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
  unchecked: true,
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

describe('needsMusicCheck and checkedCandidate', () => {
  it('only a lone candidate still marked waits for the check', () => {
    expect(needsMusicCheck([candidate()])).toBe(true);
    expect(needsMusicCheck([candidate({ unchecked: undefined, videoType: 'ATV' })])).toBe(false);
    expect(needsMusicCheck([])).toBe(false);
  });

  it('fills in the type and drops the mark', () => {
    const c = checkedCandidate(candidate(), 'OMV');
    expect(c.videoType).toBe('OMV');
    expect('unchecked' in c).toBe(false);
    expect(c.reasons).toEqual(['From your YouTube Music likes']);
  });

  it('an upload says why it is being asked about, once', () => {
    const c = checkedCandidate(checkedCandidate(candidate(), 'UGC'), 'UGC');
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
  it('every like the transfer got through that did not become a song, a check or a miss', () => {
    expect(notMusicCount({ cursor: 16, accepted: 5, review: 5, missing: 0 })).toBe(6);
    // Stopped halfway: only what it got through counts.
    expect(notMusicCount({ cursor: 8, accepted: 3, review: 2, missing: 0 })).toBe(3);
    expect(notMusicCount({ cursor: 0, accepted: 0, review: 0, missing: 0 })).toBe(0);
  });
});
