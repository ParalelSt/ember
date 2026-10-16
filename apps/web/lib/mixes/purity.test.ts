import { describe, expect, it } from 'vitest';
import { scoreSongs, type PlayEvent } from './score';
import { clusterMember, type ArtistFamily } from './cluster';
import { assembleMix, pickSeeds, type GenreOf } from './build';
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
