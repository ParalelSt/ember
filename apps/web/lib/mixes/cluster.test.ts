import { describe, expect, it } from 'vitest';
import { clusterMember, FAMILY_MIN_WEIGHT, MAX_STYLE_PLANS, MEMBER_MIN_WEIGHT, SUB_MAX_SHARE, type ArtistFamily } from './cluster';
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
    const songs = [song('A', 10), song('A', 6), song('B', 2), song('C', 1), song('D', 1), song('E', 1.5)];
    const genres = new Map([['a', fam('pop')], ['b', fam('pop')], ['c', fam('jazz-blues')], ['d', fam('jazz-blues')], ['e', fam('jazz-blues')]]);
    const r = clusterMember(songs, genres);
    expect(r.mixes.map((m) => m.key)).toEqual(['pop']);
    expect(3.5).toBeLessThan(FAMILY_MIN_WEIGHT);
    // The lower bar: four weight in three songs by two artists is a mix.
    const low = clusterMember([...songs, song('E', 0.5)], genres);
    expect(low.mixes.map((m) => m.key)).toEqual(['pop', 'jazz-blues']);
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

  it('orders mixes by weight and keeps at most MAX_STYLE_PLANS', () => {
    const fams: FamilySlug[] = ['rock-metal', 'pop', 'hiphop-rnb', 'electronic', 'latin', 'balkan', 'country-folk', 'jazz-blues'];
    const songs: SongScore[] = [];
    const genres = new Map<string, ArtistFamily>();
    fams.forEach((f, i) => {
      for (const a of [`${f}-a`, `${f}-b`]) genres.set(a, fam(f));
      songs.push(song(`${f}-a`, 10 - i), song(`${f}-a`, 1), song(`${f}-b`, 1));
    });
    const r = clusterMember(songs, genres);
    expect(r.mixes).toHaveLength(MAX_STYLE_PLANS);
    expect(r.mixes.map((m) => m.key)).toEqual(fams.slice(0, MAX_STYLE_PLANS));
  });

  it('a lone qualifying sub-genre is its own mix next to the family when it is not most of it', () => {
    const genres = new Map([
      ['punk1', fam('rock-metal', 'punk')], ['punk2', fam('rock-metal', 'punk')],
      ['r1', fam('rock-metal', 'rock')], ['r2', fam('rock-metal')], ['r3', fam('rock-metal')],
    ]);
    const punk = [song('Punk1', 2), song('Punk1', 1.5), song('Punk2', 1.5)];
    const other = [song('R1', 2), song('R2', 2), song('R3', 2), song('R1', 1)];
    const r = clusterMember([...punk, ...other], genres);
    expect(r.mixes.map((m) => m.key)).toEqual(['rock-metal', 'punk']);
    expect(r.mixes[1]).toMatchObject({ family: 'rock-metal', sub: 'punk' });
    // When punk is most of the family, it is just the family mix.
    const mostly = clusterMember([...punk, ...punk.map((x) => ({ ...x, key: `${x.key}2` })), song('R1', 0.5), song('R2', 0.5)], genres);
    expect(mostly.mixes[0].weight * SUB_MAX_SHARE).toBeLessThan(10);
    expect(mostly.mixes.map((m) => m.key)).toEqual(['rock-metal']);
  });

  it('several sub-genres plus the family mix when the rest still qualifies (Balkan by style)', () => {
    const genres = new Map<string, ArtistFamily>([
      ['ceca', fam('balkan', 'turbofolk')], ['saban', fam('balkan', 'turbofolk')],
      ['riblja', fam('balkan', 'balkan-rock')], ['ekv', fam('balkan', 'balkan-rock')],
      ['x1', fam('balkan')], ['x2', fam('balkan')],
    ]);
    const songs = [
      song('Ceca', 3), song('Ceca', 2), song('Saban', 2),
      song('Riblja', 3), song('Riblja', 2), song('EKV', 2),
      song('X1', 2), song('X1', 2), song('X2', 2),
    ];
    const r = clusterMember(songs, genres);
    expect(r.mixes.map((m) => m.key)).toEqual(['balkan', 'balkan-rock', 'turbofolk']);
    // The family mix holds every Balkan song; each style only its own.
    expect(r.mixes[0].songs).toHaveLength(9);
    expect(r.mixes.find((m) => m.key === 'turbofolk')?.artists.sort()).toEqual(['ceca', 'saban']);
  });

  it('variety: every family gets its first mix before any family gets a second', () => {
    const genres = new Map<string, ArtistFamily>([
      ['m1', fam('rock-metal', 'metal')], ['m2', fam('rock-metal', 'metal')],
      ['p1', fam('rock-metal', 'punk')], ['p2', fam('rock-metal', 'punk')],
      ['i1', fam('rock-metal', 'indie')], ['i2', fam('rock-metal', 'indie')],
      ['j1', fam('jazz-blues')], ['j2', fam('jazz-blues')],
    ]);
    const heavy = (a: string, b: string) => [song(a, 5), song(a, 4), song(b, 4)];
    const songs = [...heavy('M1', 'M2'), ...heavy('P1', 'P2'), ...heavy('I1', 'I2'), song('J1', 2), song('J1', 1), song('J2', 1.5)];
    const r = clusterMember(songs, genres);
    // Rock & Metal splits three ways with nothing left over: no family mix.
    expect(r.mixes.map((m) => m.key)).toEqual(['indie', 'jazz-blues', 'metal', 'punk']);
  });
});
