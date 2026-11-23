import { describe, expect, it } from 'vitest';
import { scoreSongs, type PlayEvent } from './score';
import { clusterMember, type ArtistFamily } from './cluster';
import { assembleMix, MIN_MIX_SIZE, pickSeeds, type GenreOf } from './build';
import { radioSpeaksFor, untaggedHomes, type SeedRadio } from './untagged';
import { artistKey } from '../genres/artistKey';
import type { FamilySlug } from '../genres/taxonomy';
import { tt } from '@/test-utils/mixTracks';
import type { Track } from '@/types/track';

// The purity simulation (docs/mixes.md): a member who plays 70% rock and
// metal and 30% pop, radios that leak the other family on purpose, and
// artists nobody could tag. Over 30 simulated days, the rock mix must not
// get one pop song and the pop mix not one rock song.

const DAY = 86400000;
const START = Date.parse('2026-09-01T04:00:00Z');

// The truth the engine does not see for untagged artists.
const truth = new Map<string, FamilySlug>();
const genres = new Map<string, GenreOf & ArtistFamily>();
function artist(name: string, family: FamilySlug, tagged = true, sub: 'rock' | 'metal' | null = null) {
  truth.set(artistKey(name), family);
  if (tagged) genres.set(artistKey(name), { family, sub });
  return name;
}

const rockOwn = Array.from({ length: 8 }, (_, i) => artist(`Rock Own ${i}`, 'rock-metal', true, i % 2 ? 'metal' : 'rock'));
const popOwn = Array.from({ length: 4 }, (_, i) => artist(`Pop Own ${i}`, 'pop'));
const rockNew = Array.from({ length: 40 }, (_, i) => artist(`Rock New ${i}`, 'rock-metal', true, i % 2 ? 'metal' : 'rock'));
const popNew = Array.from({ length: 25 }, (_, i) => artist(`Pop New ${i}`, 'pop'));
// Untagged: one only ever in pop radio, one in rock radios but listed in
// the pop chart, one untagged rocker that every rock radio brings.
const ghostPop = artist('Ghost Pop', 'pop', false);
const chartPop = artist('Chart Pop', 'pop', false);
const ghostRock = artist('Ghost Rock', 'rock-metal', false);
const popChartArtists = new Set([artistKey(chartPop), ...popNew.slice(0, 5).map(artistKey)]);
const rockChartArtists = new Set(rockNew.slice(0, 5).map(artistKey));

const songsOf = (names: string[], per: number) => names.flatMap((n, i) => Array.from({ length: per }, (_, j) => tt(`${n.replace(/\W/g, '')}${j}`.slice(-9) + i, n, `${n} Song ${j}`)));
const ownRock = songsOf(rockOwn, 5);
const ownPop = songsOf(popOwn, 5);

let rngState = 7;
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
};

/** 70% rock, 30% pop plays, a few a day for 90 days before `now`. */
function plays(now: number): PlayEvent[] {
  const out: PlayEvent[] = [];
  for (let d = 0; d < 90; d++) {
    for (let k = 0; k < 4; k++) {
      const rock = rand() < 0.7;
      const list = rock ? ownRock : ownPop;
      out.push({ track: list[Math.floor(rand() * list.length)], playedAt: new Date(now - d * DAY - k * 3600000).toISOString() });
    }
  }
  return out;
}

/** A radio for a seed: mostly its own family, a third the other one, and
 *  the untagged artists. */
function radioFor(seed: Track, day: number): Track[] {
  const fam = truth.get(artistKey(seed.artist));
  const same = fam === 'pop' ? popNew : rockNew;
  const other = fam === 'pop' ? rockNew : popNew;
  const out: Track[] = [];
  for (let i = 0; i < 30; i++) {
    const pickOther = i % 3 === 2;
    const pool = pickOther ? other : same;
    const name = pool[(i * 7 + day) % pool.length];
    out.push(tt(`r${day}${i}${name.length}${seed.sourceId.slice(0, 3)}`, name, `${name} Radio ${day}-${i}`));
  }
  if (fam === 'pop') out.push(tt(`gp${day}${seed.sourceId.slice(0, 4)}`, ghostPop, `Ghost Pop ${day}`));
  else {
    out.push(tt(`cp${day}${seed.sourceId.slice(0, 4)}`, chartPop, `Chart Pop ${day}`));
    out.push(tt(`gr${day}${seed.sourceId.slice(0, 4)}`, ghostRock, `Ghost Rock ${day}`));
  }
  return out;
}

describe('genre mix purity', () => {
  it('30 days: zero pop in the rock mix, zero rock in the pop mix', () => {
    let built = 0;
    for (let day = 0; day < 30; day++) {
      const now = START + day * DAY;
      const dayStr = new Date(now).toISOString().slice(0, 10);
      const songs = scoreSongs(plays(now), [], now);
      const { eligible, mixes } = clusterMember(songs, genres);
      expect(eligible).toBe(true);
      expect([...new Set(mixes.map((m) => m.family))].sort()).toEqual(['pop', 'rock-metal']);
      for (const plan of mixes) {
        const seeds = pickSeeds(plan, dayStr);
        const radios = seeds.map((sd) => ({ seed: sd.track.sourceId, tracks: radioFor(sd.track, day) }));
        const chartTracks = (plan.family === 'pop' ? popNew.slice(0, 5) : rockNew.slice(0, 5)).map((n, i) => tt(`ch${i}${plan.family}`, n));
        const other = plan.family === 'pop' ? rockChartArtists : popChartArtists;
        const tracks = assembleMix({ plan, radios, chartTracks, genres, otherFamilyChartArtists: other, unavailable: new Set() });
        expect(tracks, `${plan.key} day ${day}`).not.toBeNull();
        const leaks = tracks!.filter((t) => truth.get(artistKey(t.artist)) !== plan.family);
        expect(leaks.map((t) => `${plan.key}: ${t.artist}`)).toEqual([]);
        if (plan.sub) {
          // A split mix keeps to its half too.
          const wrongHalf = tracks!.filter((t) => { const g = genres.get(artistKey(t.artist)); return g?.sub && g.sub !== plan.sub; });
          expect(wrongHalf.map((t) => `${plan.key}: ${t.artist}`)).toEqual([]);
        }
        if (plan.family === 'rock-metal') {
          // The untagged rocker every rock radio brings made it in.
          expect(tracks!.some((t) => t.artist === ghostRock)).toBe(true);
        }
        built++;
      }
    }
    // Two to three mixes a day (Rock & Metal splits when both halves are big).
    expect(built).toBeGreaterThanOrEqual(60);
  });
});

// The third taste (Game & Anime): a member who plays rock, pop and game
// music, most of it by uploader channels nobody can tag, some of it with
// the game in the title. "Namesake" is tagged pop (another, more famous
// artist of that name) but their songs' radio is game music. Built the way
// the job builds: every style mix's radios decide which seeds vouch and
// where each unknown uploader lives (lib/mixes/untagged).
describe('genre mix purity with Game & Anime', () => {
  const gTruth = new Map<string, FamilySlug>();
  const gGenres = new Map<string, GenreOf & ArtistFamily>();
  const who = (name: string, family: FamilySlug, tagged = true) => {
    gTruth.set(artistKey(name), family);
    if (tagged) gGenres.set(artistKey(name), { family, sub: null });
    return name;
  };
  const gRockOwn = Array.from({ length: 6 }, (_, i) => who(`Grock Own ${i}`, 'rock-metal'));
  const gPopOwn = Array.from({ length: 3 }, (_, i) => who(`Gpop Own ${i}`, 'pop'));
  const namesake = 'Namesake';
  gTruth.set(artistKey(namesake), 'game-anime');
  gGenres.set(artistKey(namesake), { family: 'pop', sub: null });
  const vocaloidOwn = Array.from({ length: 2 }, (_, i) => who(`Vocaloid P ${i}`, 'game-anime'));
  const gRockNew = Array.from({ length: 30 }, (_, i) => who(`Grock New ${i}`, 'rock-metal'));
  const gPopNew = Array.from({ length: 25 }, (_, i) => who(`Gpop New ${i}`, 'pop'));
  const vocaloidNew = Array.from({ length: 12 }, (_, i) => who(`Vocaloid New ${i}`, 'game-anime'));
  const uploaders = Array.from({ length: 15 }, (_, i) => who(`Upload Chan ${i}`, 'game-anime', false));
  const ostChans = Array.from({ length: 8 }, (_, i) => who(`Ost Chan ${i}`, 'game-anime', false));
  const ghost = who('Ghost Popper', 'pop', false);

  const own = (names: string[], per: number, title: (n: string, j: number) => string) =>
    names.flatMap((n, i) => Array.from({ length: per }, (_, j) => tt(`o${n.replace(/\W/g, '').slice(-6)}${i}${j}`, n, title(n, j))));
  const ownRockG = own(gRockOwn, 4, (n, j) => `${n} Song ${j}`);
  const ownPopG = own(gPopOwn, 4, (n, j) => `${n} Song ${j}`);
  const ownNamesake = own([namesake], 5, (n, j) => `Evil Intention ${j}`);
  const ownGame = [
    ...own(vocaloidOwn, 3, (n, j) => `${n} Song ${j}`),
    ...own(ostChans.slice(0, 4), 2, (n, j) => `Stage ${j} (Original Soundtrack)`),
    tt('ultrakill00', 'KEYGEN CHURCH', 'Tenebre Rosso Sangue (ULTRAKILL Soundtrack)'),
  ];
  gTruth.set(artistKey('KEYGEN CHURCH'), 'game-anime');

  let st = 11;
  const rnd = () => {
    st = (st * 1103515245 + 12345) % 2147483648;
    return st / 2147483648;
  };
  function gPlays(now: number): PlayEvent[] {
    const out: PlayEvent[] = [];
    for (let d = 0; d < 90; d++) {
      for (let k = 0; k < 6; k++) {
        const x = rnd();
        const list = x < 0.4 ? ownRockG : x < 0.6 ? ownPopG : x < 0.7 ? ownNamesake : ownGame;
        out.push({ track: list[Math.floor(rnd() * list.length)], playedAt: new Date(now - d * DAY - k * 3600000).toISOString() });
      }
    }
    return out;
  }

  const gameRadio = (seed: Track, day: number): Track[] => {
    const out: Track[] = [];
    for (let i = 0; i < 30; i++) {
      const k = (i * 5 + day) % 3;
      if (k === 0) { const n = vocaloidNew[(i + day) % vocaloidNew.length]; out.push(tt(`v${day}${i}${seed.sourceId.slice(0, 4)}`, n, `${n} ${day}-${i}`)); }
      else if (k === 1) { const n = uploaders[(i + day) % uploaders.length]; out.push(tt(`u${day}${i}${seed.sourceId.slice(0, 4)}`, n, `Track ${day}-${i}`)); }
      else { const n = ostChans[(i + day) % ostChans.length]; out.push(tt(`s${day}${i}${seed.sourceId.slice(0, 4)}`, n, `Level ${i} (Game OST)`)); }
    }
    return out;
  };
  function gRadioFor(seed: Track, day: number): Track[] {
    const fam = gTruth.get(artistKey(seed.artist));
    if (fam === 'game-anime') return gameRadio(seed, day);
    const same = fam === 'pop' ? gPopNew : gRockNew;
    const other = fam === 'pop' ? gRockNew : gPopNew;
    const out: Track[] = [];
    for (let i = 0; i < 30; i++) {
      const pool = i % 3 === 2 ? other : same;
      const name = pool[(i * 7 + day) % pool.length];
      out.push(tt(`r${day}${i}${name.length}${seed.sourceId.slice(0, 3)}`, name, `${name} Radio ${day}-${i}`));
    }
    if (fam === 'pop') out.push(tt(`gh${day}${seed.sourceId.slice(0, 4)}`, ghost, `Ghost ${day}`));
    return out;
  }

  it('30 days: no game song in Pop or Rock, no pop or rock in Game & Anime, Game & Anime every day', () => {
    let gaDays = 0;
    let outOfPlace = 0;
    let ghostDays = 0;
    for (let day = 0; day < 30; day++) {
      const now = START + day * DAY;
      const dayStr = new Date(now).toISOString().slice(0, 10);
      const songs = scoreSongs(gPlays(now), [], now);
      const { mixes } = clusterMember(songs, gGenres);
      expect(mixes.map((m) => m.family)).toContain('game-anime');
      const seeded = mixes.map((plan) => ({ plan, radios: pickSeeds(plan, dayStr).map((sd) => ({ seed: sd.track.sourceId, tracks: gRadioFor(sd.track, day) })) }));
      const styleRadios: SeedRadio[] = seeded.flatMap(({ plan, radios }) => radios.map((r) => ({ family: plan.family, ...r })));
      const homes = untaggedHomes(styleRadios, gGenres, songs.map((x) => x.track));
      for (const { plan, radios } of seeded) {
        const vouching = new Set(radios.filter((r) => radioSpeaksFor({ family: plan.family, ...r }, gGenres) === plan.family).map((r) => r.seed));
        outOfPlace += radios.length - vouching.size;
        const chartTracks = plan.family === 'pop' ? gPopNew.slice(0, 5).map((n, i) => tt(`gc${i}p`, n)) : plan.family === 'rock-metal' ? gRockNew.slice(0, 5).map((n, i) => tt(`gc${i}r`, n)) : [];
        const tracks = assembleMix({ plan, radios, chartTracks, genres: gGenres, otherFamilyChartArtists: new Set(), unavailable: new Set(), vouching, untaggedHomes: homes });
        if (plan.family === 'game-anime') {
          expect(tracks, `game-anime day ${day}`).not.toBeNull();
          expect(tracks!.length).toBeGreaterThanOrEqual(MIN_MIX_SIZE);
          gaDays++;
        }
        if (!tracks) continue;
        // The namesake's own songs stay in Pop until phase 2 (radio memory).
        const leaks = tracks.filter((t) => artistKey(t.artist) !== artistKey(namesake) && (gTruth.get(artistKey(t.artist)) ?? 'game-anime') !== plan.family);
        expect(leaks.map((t) => `${plan.key} day ${day}: ${t.artist} - ${t.title}`)).toEqual([]);
        // Two pop radios that vouch for Pop still bring in its untagged pop artist.
        if (plan.family === 'pop' && vouching.size >= 2) {
          expect(tracks.some((t) => t.artist === ghost), `pop day ${day} keeps its untagged pop artist`).toBe(true);
          ghostDays++;
        }
      }
    }
    expect(gaDays).toBe(30);
    expect(ghostDays).toBeGreaterThan(10);
    // The namesake's seeds were caught as out of place on some days.
    expect(outOfPlace).toBeGreaterThan(0);
  });
});
