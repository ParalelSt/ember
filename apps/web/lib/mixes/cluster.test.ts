import { describe, expect, it } from 'vitest';
import { clusterMember, FAMILY_MIN_WEIGHT, MAX_MIXES, MEMBER_MIN_WEIGHT, type ArtistFamily } from './cluster';
import type { SongScore } from './score';
import { tt } from '@/test-utils/mixTracks';
import type { FamilySlug, SubSlug } from '../genres/taxonomy';

let n = 0;
const song = (artist: string, score: number): SongScore => {
  const track = tt(`s${n++}`, artist);
  return { key: `${track.title}::${artist}`, track, artistKey: artist.toLowerCase(), score, plays: 1, liked: false };
};
const fam = (family: FamilySlug | null, sub: SubSlug | null = null): ArtistFamily => ({ family, sub });

describe('clusterMember', () => {
  it('is not eligible under the member threshold', () => {
    const songs = [song('Tool', 3), song('Tool', 3), song('Gojira', 3)];
    const r = clusterMember(songs, new Map([['tool', fam('rock-metal')], ['gojira', fam('rock-metal')]]));
    expect(r.total).toBeLessThan(MEMBER_MIN_WEIGHT);
    expect(r).toMatchObject({ eligible: false, mixes: [] });
  });

  it('keeps a family with weight, three songs and two artists; drops thin ones', () => {
    const songs = [
      song('Tool', 5), song('Tool', 4), song('Gojira', 3),
      song('Dua', 4), song('Dua', 3), song('Dua', 2),
      song('Miles', 1),
    ];
    const genres = new Map([['tool', fam('rock-metal')], ['gojira', fam('rock-metal')], ['dua', fam('pop')], ['miles', fam('jazz-blues')]]);
    const r = clusterMember(songs, genres);
    expect(r.eligible).toBe(true);
    // Pop has the weight and the songs but only one artist.
    expect(r.mixes.map((m) => m.key)).toEqual(['rock-metal']);
    expect(r.mixes[0].weight).toBe(12);
    expect(r.mixes[0].artists).toEqual(['tool', 'gojira']);
  });

  it('a family under FAMILY_MIN_WEIGHT is left out', () => {
    const songs = [song('A', 10), song('A', 6), song('B', 2), song('C', 1), song('D', 1), song('E', 3)];
    const genres = new Map([['a', fam('pop')], ['b', fam('pop')], ['c', fam('jazz-blues')], ['d', fam('jazz-blues')], ['e', fam('jazz-blues')]]);
    const r = clusterMember(songs, genres);
    expect(r.mixes.map((m) => m.key)).toEqual(['pop']);
    expect(5).toBeLessThan(FAMILY_MIN_WEIGHT);
  });

  it('splits Rock & Metal only when both halves are mixes on their own', () => {
    const rock = [song('Foo', 4), song('Foo', 3), song('Pearl', 3)];
    const metal = [song('Gojira', 4), song('Gojira', 3), song('Slayer', 3)];
    const genres = new Map([
      ['foo', fam('rock-metal', 'rock')], ['pearl', fam('rock-metal', 'rock')],
      ['gojira', fam('rock-metal', 'metal')], ['slayer', fam('rock-metal', 'metal')],
    ]);
    const both = clusterMember([...rock, ...metal], genres);
    expect(both.mixes.map((m) => m.key).sort()).toEqual(['metal', 'rock']);
    expect(both.mixes.every((m) => m.family === 'rock-metal')).toBe(true);

    // Metal alone is too small: one Rock & Metal mix.
    const one = clusterMember([...rock, ...rock.map((s) => ({ ...s, key: `${s.key}x` })), song('Gojira', 2)], genres);
    expect(one.mixes.map((m) => m.key)).toEqual(['rock-metal']);
  });

  it('artists with no known half join the heavier half', () => {
    const songs = [song('Foo', 5), song('Foo', 4), song('Pearl', 3), song('Gojira', 4), song('Gojira', 3), song('Slayer', 3), song('Mystery', 2)];
    const genres = new Map([
      ['foo', fam('rock-metal', 'rock')], ['pearl', fam('rock-metal', 'rock')],
      ['gojira', fam('rock-metal', 'metal')], ['slayer', fam('rock-metal', 'metal')], ['mystery', fam('rock-metal')],
    ]);
    const r = clusterMember(songs, genres);
    expect(r.mixes.find((m) => m.key === 'rock')?.artists).toContain('mystery');
  });

  it('songs by untagged artists count for eligibility but join no mix', () => {
    const songs = [song('A', 6), song('A', 5), song('B', 4), song('Untagged', 10)];
    const r = clusterMember(songs, new Map([['a', fam('pop')], ['b', fam('pop')], ['untagged', fam(null)]]));
    expect(r.total).toBe(25);
    expect(r.mixes.map((m) => m.key)).toEqual(['pop']);
    expect(r.mixes[0].songs.some((s) => s.artistKey === 'untagged')).toBe(false);
  });

  it('orders mixes by weight and keeps at most six', () => {
    const fams: FamilySlug[] = ['rock-metal', 'pop', 'hiphop-rnb', 'electronic', 'latin', 'balkan', 'country-folk', 'jazz-blues'];
    const songs: SongScore[] = [];
    const genres = new Map<string, ArtistFamily>();
    fams.forEach((f, i) => {
      for (const a of [`${f}-a`, `${f}-b`]) genres.set(a, fam(f));
      songs.push(song(`${f}-a`, 10 - i), song(`${f}-a`, 1), song(`${f}-b`, 1));
    });
    const r = clusterMember(songs, genres);
    expect(r.mixes).toHaveLength(MAX_MIXES);
    expect(r.mixes.map((m) => m.key)).toEqual(fams.slice(0, 6));
  });
});
