import { describe, expect, it } from 'vitest';
import { LIKE_BONUS, scoreArtists, scoreSongs } from './score';
import { tt } from '@/test-utils/mixTracks';

const NOW = Date.parse('2026-10-16T04:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

describe('scoreSongs', () => {
  it('decays plays over 30 days and adds 2 per like', () => {
    const a = tt('a1', 'Gojira');
    const b = tt('b1', 'Tool');
    const songs = scoreSongs([{ track: a, playedAt: daysAgo(0) }, { track: a, playedAt: daysAgo(30) }, { track: b, playedAt: daysAgo(0) }], [b], NOW);
    expect(songs.map((s) => s.track.artist)).toEqual(['Tool', 'Gojira']);
    expect(songs[1].score).toBeCloseTo(1 + Math.exp(-1), 6);
    expect(songs[0].score).toBeCloseTo(1 + LIKE_BONUS, 6);
    expect(songs[0]).toMatchObject({ plays: 1, liked: true, artistKey: 'tool' });
  });

  it('ignores plays past 90 days and unreadable dates, but keeps an old like', () => {
    const a = tt('a1', 'Old Band');
    const songs = scoreSongs([{ track: a, playedAt: daysAgo(91) }, { track: a, playedAt: 'not a date' }], [a], NOW);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ plays: 0, score: LIKE_BONUS });
  });

  it('counts two versions of one song as one, standing in for it with the version played last', () => {
    const v1 = tt('v1', 'Tool', 'Schism');
    const v2 = tt('v2', 'Tool', 'Schism (Official Video)');
    const songs = scoreSongs([{ track: v1, playedAt: daysAgo(5) }, { track: v2, playedAt: daysAgo(1) }], [], NOW);
    expect(songs).toHaveLength(1);
    expect(songs[0].track.id).toBe(v2.id);
    expect(songs[0].plays).toBe(2);
  });

  it('reads PocketBase timestamps', () => {
    const songs = scoreSongs([{ track: tt('a', 'X'), playedAt: '2026-10-16 04:00:00.000Z' }], [], NOW);
    expect(songs[0].score).toBeCloseTo(1, 6);
  });
});

describe('scoreArtists', () => {
  it('sums each artist\'s songs, heaviest first', () => {
    const songs = scoreSongs(
      [tt('a', 'Tool'), tt('b', 'Tool'), tt('c', 'Gojira')].map((track) => ({ track, playedAt: daysAgo(0) })),
      [],
      NOW,
    );
    const artists = scoreArtists(songs);
    expect(artists.map((a) => [a.key, Math.round(a.score)])).toEqual([['tool', 2], ['gojira', 1]]);
    expect(artists[0].songs).toHaveLength(2);
  });
});
