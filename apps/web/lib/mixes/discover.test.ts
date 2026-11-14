import { describe, expect, it } from 'vitest';
import { assembleDiscover, describeDiscover, DISCOVER_PER_ARTIST, DISCOVER_SEEDS, DISCOVER_SIZE, discoverSeeds, weekKey } from './discover';
import { MIN_MIX_SIZE } from './build';
import { scoreArtists, type SongScore } from './score';
import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import { tt } from '@/test-utils/mixTracks';
import type { Track } from '@/types/track';

const s = (t: Track, score: number): SongScore => ({ key: songKey(t), track: t, artistKey: artistKey(t.artist), score, plays: 1, liked: false });

describe('weekKey', () => {
  it('is the local Monday of the week', () => {
    expect(weekKey(new Date(2026, 9, 16, 4).getTime())).toBe('2026-10-12'); // Friday
    expect(weekKey(new Date(2026, 9, 18, 23).getTime())).toBe('2026-10-12'); // Sunday night
    expect(weekKey(new Date(2026, 9, 19, 0, 30).getTime())).toBe('2026-10-19'); // Monday
  });
});

describe('discoverSeeds', () => {
  const songs = Array.from({ length: 14 }, (_, i) => [s(tt(`a${i}x`, `Artist ${i}`), 30 - i), s(tt(`b${i}x`, `Artist ${i}`), 1)]).flat();
  const artists = scoreArtists(songs);

  it('one best song from each of five top artists, the same all week', () => {
    const seeds = discoverSeeds(artists, '2026-10-12');
    expect(seeds).toHaveLength(DISCOVER_SEEDS);
    expect(new Set(seeds.map((x) => x.artistKey)).size).toBe(DISCOVER_SEEDS);
    expect(seeds.every((x) => x.track.id.includes('a'))).toBe(true);
    expect(discoverSeeds(artists, '2026-10-12').map((x) => x.key)).toEqual(seeds.map((x) => x.key));
    const weeks = new Set(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((w) => discoverSeeds(artists, w).map((x) => x.key).join()));
    expect(weeks.size).toBeGreaterThan(1);
  });
});

describe('assembleDiscover', () => {
  const heardTrack = tt('heard', 'New 0', 'Already heard');
  const radios = ['a', 'b', 'c'].map((seed) => ({
    seed,
    tracks: [
      heardTrack,
      ...Array.from({ length: 12 }, (_, i) => tt(`${seed}n${i}`, `New ${i}`, `New ${i} ${seed}`)),
      ...Array.from({ length: 6 }, (_, i) => tt(`${seed}k${i}`, `Known ${i}`, `Known ${i} ${seed}`)),
    ],
  }));
  const heard = new Set([songKey(heardTrack)]);
  const knownArtists = new Set(Array.from({ length: 6 }, (_, i) => artistKey(`Known ${i}`)));

  it('never a song heard before, artists new to the member first, two songs per artist', () => {
    const out = assembleDiscover({ radios, heard, knownArtists, unavailable: new Set() })!;
    expect(out).toHaveLength(DISCOVER_SIZE);
    expect(out.some((t) => heard.has(songKey(t)))).toBe(false);
    const firstKnown = out.findIndex((t) => t.artist.startsWith('Known'));
    // 12 new artists x 2 songs come before any known artist.
    expect(firstKnown).toBe(24);
    const per = new Map<string, number>();
    for (const t of out) per.set(t.artist, (per.get(t.artist) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(DISCOVER_PER_ARTIST);
  });

  it('skips dead and blocked songs; too few is no mix', () => {
    const out = assembleDiscover({ radios, heard, knownArtists, unavailable: new Set([radios[0].tracks[1].id]), skip: (t) => t.artist === 'New 3' })!;
    expect(out.some((t) => t.id === radios[0].tracks[1].id || t.artist === 'New 3')).toBe(false);
    expect(assembleDiscover({ radios: radios.slice(0, 1).map((r) => ({ ...r, tracks: r.tracks.slice(0, 10) })), heard, knownArtists, unavailable: new Set() })).toBeNull();
    expect(MIN_MIX_SIZE).toBeGreaterThan(10);
  });

  it('describes the card with its first three artists', () => {
    const out = assembleDiscover({ radios, heard, knownArtists, unavailable: new Set() })!;
    const meta = describeDiscover(out);
    expect(meta.title).toBe('New to you');
    expect(meta.subtitle).toBe(`${[...new Set(out.map((t) => t.artist))].slice(0, 3).join(', ')} and more`);
    expect(meta.artworkUrls).toHaveLength(3);
  });

  it('a dead or blocked song is never a seed: the artist\'s next song stands in', () => {
    const songs = [s(tt('dead1', 'Solo'), 10), s(tt('good1', 'Solo'), 5)];
    const seeds = discoverSeeds(scoreArtists(songs), '2026-10-12', (x) => !x.track.id.includes('dead'));
    expect(seeds.map((x) => x.track.id)).toEqual([tt('good1', 'Solo').id]);
  });
});
