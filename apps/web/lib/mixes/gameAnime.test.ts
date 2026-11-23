import { describe, expect, it } from 'vitest';
import { assembleMix, type GenreOf } from './build';
import { clusterMember } from './cluster';
import { scoreSongs, type PlayEvent } from './score';
import { radioSpeaksFor, untaggedHomes, type SeedRadio } from './untagged';
import { artistKey } from '../genres/artistKey';
import type { FamilySlug } from '../genres/taxonomy';
import { tt } from '@/test-utils/mixTracks';
import { songKey } from '../songKey';
import type { Track } from '@/types/track';

// The owner's report as a fixture: rhythm-game and game-soundtrack songs that
// showed up in his Pop mix. His Pop plan is PinkPantheress, mietze conte and
// "Noah" (a namesake: the tags are another, pop Noah's), and the Noah songs'
// radios are full of uploads by channels nobody can tag.

const NOW = Date.parse('2026-11-20T04:00:00Z');
const tagged: [string, FamilySlug][] = [
  ['PinkPantheress', 'pop'], ['mietze conte', 'pop'], ['Noah', 'pop'],
  ['Laur', 'game-anime'], ['xi', 'game-anime'],
  ...Array.from({ length: 12 }, (_, i) => [`Fresh Pop ${i}`, 'pop'] as [string, FamilySlug]),
  ...Array.from({ length: 8 }, (_, i) => [`Bms Artist ${i}`, 'game-anime'] as [string, FamilySlug]),
];
const genres = new Map<string, GenreOf>(tagged.map(([n, f]) => [artistKey(n), { family: f, sub: null }]));

let id = 0;
const song = (artist: string, title: string) => tt(`rep${id++}`, artist, title);

const own = {
  pop: [
    song('PinkPantheress', 'Illegal'), song('PinkPantheress', 'Tonight'), song('PinkPantheress', 'Stateside'),
    song('mietze conte', 'Mayonaka no Door'), song('mietze conte', 'Plastic Love'),
  ],
  noah: [song('Noah', 'Evil intention'), song('Noah', 'Another Noah Song')],
  game: [
    song('Laur', 'Sound Chimera'), song('Laur', 'Glory Day'), song('xi', 'Freedom Dive'), song('xi', 'Blue Zenith'),
    song('KEYGEN CHURCH', 'Tenebre Rosso Sangue (ULTRAKILL Soundtrack)'),
  ],
};

// The five reported radio songs (real titles and channels).
const reported = {
  ultrakill: song('KEYGEN CHURCH', 'Tenebre Rosso Sangue (ULTRAKILL Soundtrack)'),
  blast: song('UmβRizZ', 'Blast Out From Symphony'),
  maiden: song('MrRevendread210', "Maiden's Capriccio"),
  heart: song('Lappy', 'Heart of Corruption'),
  tak: song('Tak_mfk', '夜明けの彼方へ'),
};

const freshPop = (seed: string) => Array.from({ length: 12 }, (_, i) => tt(`fp${seed}${i}`, `Fresh Pop ${i}`, `Pop Song ${seed} ${i}`));
const bms = (seed: string) => Array.from({ length: 8 }, (_, i) => tt(`bm${seed}${i}`, `Bms Artist ${i}`, `Chart ${seed} ${i}`));
const gameRadio = (seed: string): Track[] => [reported.ultrakill, reported.blast, reported.maiden, reported.heart, reported.tak, ...bms(seed)];

function plays(): PlayEvent[] {
  const at = (h: number) => new Date(NOW - h * 3600000).toISOString();
  return [
    ...own.pop.flatMap((t, i) => [1, 2, 3].map((k) => ({ track: t, playedAt: at(i + k * 24) }))),
    ...own.noah.flatMap((t, i) => [1, 2, 3, 4].map((k) => ({ track: t, playedAt: at(i + k * 24) }))),
    ...own.game.flatMap((t, i) => [1, 2, 3].map((k) => ({ track: t, playedAt: at(i + k * 24) }))),
  ];
}

describe('the reported songs', () => {
  const songs = scoreSongs(plays(), [], NOW);
  const { mixes } = clusterMember(songs, genres);
  const popPlan = mixes.find((m) => m.key === 'pop')!;
  const gaPlan = mixes.find((m) => m.key === 'game-anime')!;
  // The seeds as on the night of the report: the two Noah songs and two real pop songs.
  const popRadios = [
    { seed: own.noah[0].sourceId, tracks: [own.pop[0], ...gameRadio('n0')] },
    { seed: own.noah[1].sourceId, tracks: gameRadio('n1') },
    { seed: own.pop[0].sourceId, tracks: freshPop('p0') },
    { seed: own.pop[3].sourceId, tracks: freshPop('p3') },
  ];
  const gaRadios = [{ seed: own.game[0].sourceId, tracks: gameRadio('g0') }, { seed: own.game[2].sourceId, tracks: gameRadio('g2') }];
  const styleRadios: SeedRadio[] = [
    ...popRadios.map((r) => ({ family: 'pop' as const, ...r })),
    ...gaRadios.map((r) => ({ family: 'game-anime' as const, ...r })),
  ];
  const homes = untaggedHomes(styleRadios, genres, songs.map((s) => s.track));
  const vouch = (family: FamilySlug, radios: { seed: string; tracks: Track[] }[]) =>
    new Set(radios.filter((r) => radioSpeaksFor({ family, ...r }, genres) === family).map((r) => r.seed));
  const build = (plan: typeof popPlan, radios: { seed: string; tracks: Track[] }[]) =>
    assembleMix({ plan, radios, chartTracks: [], genres, otherFamilyChartArtists: new Set(), unavailable: new Set(), vouching: vouch(plan.family, radios), untaggedHomes: homes });
  const pop = build(popPlan, popRadios)!;
  const ga = build(gaPlan, gaRadios)!;
  const inMix = (tracks: Track[], t: Track) => tracks.some((x) => songKey(x) === songKey(t));

  it('the member gets a Pop plan and a Game & Anime plan; his ULTRAKILL song is in the second', () => {
    expect(popPlan.artists.sort()).toEqual(['mietze conte', 'noah', 'pinkpantheress']);
    expect(gaPlan.songs.map((s) => s.track.title)).toContain('Tenebre Rosso Sangue (ULTRAKILL Soundtrack)');
    expect(pop).not.toBeNull();
    expect(ga).not.toBeNull();
  });

  it('the Noah seeds\' radios are out of place: they speak for Game & Anime', () => {
    expect(vouch('pop', popRadios)).toEqual(new Set([own.pop[0].sourceId, own.pop[3].sourceId]));
  });

  it('none of the five radio songs is in Pop; each is in Game & Anime', () => {
    for (const [name, t] of Object.entries(reported)) {
      expect(inMix(pop, t), `${name} in Pop`).toBe(false);
      expect(inMix(ga, t), `${name} in Game & Anime`).toBe(true);
    }
    expect(homes.get(artistKey('UmβRizZ'))).toBe('game-anime');
    expect(homes.get(artistKey('Lappy'))).toBe('game-anime');
  });

  it('real pop stays in Pop', () => {
    expect(inMix(pop, own.pop[0])).toBe(true);
    expect(pop.some((t) => t.artist === 'mietze conte')).toBe(true);
    expect(pop.some((t) => t.artist.startsWith('Fresh Pop'))).toBe(true);
  });

  it('phase 2 case: "Evil intention" by the namesake Noah stays in Pop for now', () => {
    // Flip this when radio memory (phase 2) lands.
    expect(inMix(pop, own.noah[0])).toBe(true);
    expect(inMix(ga, own.noah[0])).toBe(false);
  });
});
