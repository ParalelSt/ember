import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import { mixLook, type FamilySlug, type SubSlug } from '../genres/taxonomy';
import type { Track } from '../../types/track';
import type { MixPlan } from './cluster';
import type { SongScore } from './score';

/** One mix's songs (docs/mixes.md): up to 20 of the member's own songs in
 *  the family, then new songs from the radio of a few of them and the
 *  family's genre chart, woven together like radio. Pure.
 *
 *  Purity is the rule that matters: a new song is only taken when its
 *  artist's primary family is the mix's family (and, for a split mix, their
 *  half matches). An artist nobody could tag is kept only when the radio of
 *  two or more seeds brought them AND no other family's chart lists them.
 *  Everything else is dropped, so a Rock & Metal mix never gets pop. */

export const MIX_SIZE = 50;
export const MIN_MIX_SIZE = 20;
export const KNOWN_MAX = 20;
export const PER_ARTIST_MAX = 3;
export const SEEDS_PER_MIX = 4;
/** Seeds are drawn from this many of the member's top songs in the mix. */
export const SEED_POOL = 10;
const FRONT_LOAD = 2;
const WEAVE_EVERY = 3;

/** A small seeded PRNG (mulberry32) so a day's seeds are the same every
 *  time that day's build runs, and different the next day. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The day's seeds for a mix: SEEDS_PER_MIX of its top SEED_POOL songs,
 *  shuffled by the date (YYYY-MM-DD) and the mix key, so mixes change from
 *  day to day but a rerun on the same day gives the same mix. YouTube songs
 *  only: an upload has no radio. */
export function pickSeeds(plan: Pick<MixPlan, 'key' | 'songs'>, day: string, n = SEEDS_PER_MIX): SongScore[] {
  const pool = plan.songs.filter((s) => s.track.source === 'youtube').slice(0, SEED_POOL);
  const rand = prng(hash(`${day}|${plan.key}`));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

export interface GenreOf {
  family: FamilySlug | null;
  sub: SubSlug | null;
  /** An admin's "no family": never counted as merely untagged. */
  manual?: boolean;
}

export interface AssembleInput {
  plan: MixPlan;
  /** Each seed's radio, in the order the seeds were picked. */
  radios: readonly { seed: string; tracks: readonly Track[] }[];
  /** The family's genre chart songs (filler for a family the radio is thin on). */
  chartTracks: readonly Track[];
  /** Known artist genres by artist key. */
  genres: ReadonlyMap<string, GenreOf>;
  /** Artist keys listed in a genre chart of another family. */
  otherFamilyChartArtists: ReadonlySet<string>;
  /** Track ids the server knows are dead. */
  unavailable: ReadonlySet<string>;
}

/** Whether a new song's artist belongs in this mix. */
export function belongs(
  plan: Pick<MixPlan, 'family' | 'sub'>,
  key: string,
  genres: ReadonlyMap<string, GenreOf>,
  radioCount: number,
  otherFamilyChartArtists: ReadonlySet<string>,
): boolean {
  const g = genres.get(key);
  if (g?.family) return g.family === plan.family && (!plan.sub || g.sub === plan.sub);
  if (g?.manual) return false;
  return radioCount >= 2 && !otherFamilyChartArtists.has(key);
}

/** Weave known songs into new ones the way radio does: two known songs
 *  first, then one known song in every three. */
export function weave(known: readonly Track[], fresh: readonly Track[], size = MIX_SIZE): Track[] {
  const out: Track[] = [];
  let ki = 0;
  let fi = 0;
  while (ki < Math.min(FRONT_LOAD, known.length) && out.length < size) out.push(known[ki++]);
  while ((ki < known.length || fi < fresh.length) && out.length < size) {
    if (ki < known.length && out.length % WEAVE_EVERY === 0) out.push(known[ki++]);
    else if (fi < fresh.length) out.push(fresh[fi++]);
    else out.push(known[ki++]);
  }
  return out;
}

/** The mix's tracks, or null when fewer than MIN_MIX_SIZE survive (the
 *  mix is then not written). */
export function assembleMix(input: AssembleInput): Track[] | null {
  const { plan, radios, chartTracks, genres, otherFamilyChartArtists, unavailable } = input;
  const perArtist = new Map<string, number>();
  const usedKeys = new Set<string>();
  const take = (t: Track, aKey: string) => {
    perArtist.set(aKey, (perArtist.get(aKey) ?? 0) + 1);
    usedKeys.add(songKey(t));
  };
  const room = (aKey: string) => (perArtist.get(aKey) ?? 0) < PER_ARTIST_MAX;

  const known: Track[] = [];
  for (const s of plan.songs) {
    if (known.length >= KNOWN_MAX) break;
    if (unavailable.has(s.track.id) || usedKeys.has(s.key) || !room(s.artistKey)) continue;
    take(s.track, s.artistKey);
    known.push(s.track);
  }

  // How many of this mix's seed radios brought each artist.
  const radioCount = new Map<string, number>();
  for (const r of radios) {
    for (const k of new Set(r.tracks.map((t) => artistKey(t.artist)))) radioCount.set(k, (radioCount.get(k) ?? 0) + 1);
  }

  // Round robin over the radios so every seed has a say, then the chart.
  const pool: Track[] = [];
  const longest = Math.max(0, ...radios.map((r) => r.tracks.length));
  for (let i = 0; i < longest; i++) for (const r of radios) if (r.tracks[i]) pool.push(r.tracks[i]);
  pool.push(...chartTracks);

  const fresh: Track[] = [];
  for (const t of pool) {
    if (known.length + fresh.length >= MIX_SIZE) break;
    if (!t || unavailable.has(t.id)) continue;
    const k = songKey(t);
    if (usedKeys.has(k)) continue;
    const aKey = artistKey(t.artist);
    if (!aKey || !room(aKey)) continue;
    if (!belongs(plan, aKey, genres, radioCount.get(aKey) ?? 0, otherFamilyChartArtists)) continue;
    take(t, aKey);
    fresh.push(t);
  }

  const tracks = weave(known, fresh, MIX_SIZE);
  return tracks.length >= MIN_MIX_SIZE ? tracks : null;
}

export interface MixMeta {
  title: string;
  /** "Gojira, Tool, Metallica and more". */
  subtitle: string;
  /** Up to three covers, one per top artist, for the card's round faces. */
  artworkUrls: string[];
  color: string;
}

/** The card's words and faces: the mix's name (without "Mix") and its top
 *  three artists, each with the cover of their best song in it. */
export function describeMix(plan: Pick<MixPlan, 'key' | 'songs' | 'artists'>, tracks: readonly Track[]): MixMeta {
  const look = mixLook(plan.key);
  const top = plan.artists.slice(0, 3);
  const names: string[] = [];
  const art: string[] = [];
  for (const key of top) {
    const best = plan.songs.find((s) => s.artistKey === key);
    if (!best) continue;
    names.push(best.track.artist);
    if (best.track.artworkUrl) art.push(best.track.artworkUrl);
  }
  for (const t of tracks) {
    if (art.length >= 3) break;
    if (t.artworkUrl && !art.includes(t.artworkUrl)) art.push(t.artworkUrl);
  }
  const subtitle = names.length ? `${names.join(', ')} and more` : '';
  return { title: look.name, subtitle, artworkUrls: art.slice(0, 3), color: look.tint };
}
