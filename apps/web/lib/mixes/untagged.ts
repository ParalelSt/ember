import { artistKey } from '../genres/artistKey';
import { songSignal } from '../genres/songSignal';
import type { FamilySlug } from '../genres/taxonomy';
import type { Track } from '../../types/track';
import type { GenreOf } from './build';
import { resolveGenre } from './songFamily';

/** Where an artist nobody could tag belongs (docs/mixes.md, "Unknown
 *  artists"). Pure; computed once per build from the radios of every style
 *  mix, after the radio artists are tagged.
 *
 *  A. A radio can be out of place: when another family has at least
 *     CONTRA_MIN of its songs and more than the seed's own family, the radio
 *     speaks for that family, not for the mix that seeded it (a "Pop" seed
 *     whose radio is all game music cannot vouch for anybody in Pop).
 *  B. Every unknown artist gets at most one home: Game & Anime when any song
 *     of theirs seen tonight has a title signal, else the family whose
 *     radios brought them most (Game & Anime from one radio and winning
 *     ties, any other family from two and no tie), else none. */

export interface SeedRadio {
  /** The family of the style mix that picked the seed. */
  family: FamilySlug;
  seed: string;
  tracks: readonly Track[];
}

/** Songs of another family a radio needs (and more than its own) to be out of place. */
export const CONTRA_MIN = 5;
/** This mix's vouching radios that must bring an unknown artist. */
export const UNTAGGED_MIN_RADIOS = 2;
/** The same for Game & Anime: there the unknown uploader is the norm and
 *  there is no chart to fill the mix. */
export const UNTAGGED_MIN_RADIOS_GAME_ANIME = 1;

export function untaggedMinRadios(family: FamilySlug): number {
  return family === 'game-anime' ? UNTAGGED_MIN_RADIOS_GAME_ANIME : UNTAGGED_MIN_RADIOS;
}

const isUntagged = (g: GenreOf | undefined) => !g?.family && !g?.manual;

/** A radio's songs per family (lib/mixes/songFamily); unknown songs do not count. */
export function radioFamilies(radio: Pick<SeedRadio, 'tracks'>, genres: ReadonlyMap<string, GenreOf>): Map<FamilySlug, number> {
  const out = new Map<FamilySlug, number>();
  for (const t of radio.tracks) {
    const f = resolveGenre(t, genres).family;
    if (f) out.set(f, (out.get(f) ?? 0) + 1);
  }
  return out;
}

/** The family a seed's radio vouches for: its mix's family, unless one
 *  other family clearly outweighs it (A). */
export function radioSpeaksFor(radio: SeedRadio, genres: ReadonlyMap<string, GenreOf>): FamilySlug {
  const counts = radioFamilies(radio, genres);
  const own = counts.get(radio.family) ?? 0;
  let best: FamilySlug | null = null;
  let top = 0;
  let tie = false;
  for (const [f, n] of counts) {
    if (f === radio.family) continue;
    if (n > top) {
      best = f;
      top = n;
      tie = false;
    } else if (n === top) {
      tie = true;
    }
  }
  return best && !tie && top >= CONTRA_MIN && top > own ? best : radio.family;
}

/** Each unknown artist of tonight's radios with a home, if they have one (B). */
export function untaggedHomes(
  radios: readonly SeedRadio[],
  genres: ReadonlyMap<string, GenreOf>,
  ownTracks: readonly Track[],
): Map<string, FamilySlug> {
  const signalled = new Set<string>();
  const bySeed = new Map<string, Map<FamilySlug, Set<string>>>();
  for (const t of [...ownTracks, ...radios.flatMap((r) => r.tracks)]) {
    const k = artistKey(t.artist);
    if (k && isUntagged(genres.get(k)) && songSignal(t)) signalled.add(k);
  }
  for (const r of radios) {
    const speaks = radioSpeaksFor(r, genres);
    for (const k of new Set(r.tracks.map((t) => artistKey(t.artist)))) {
      if (!k || !isUntagged(genres.get(k))) continue;
      const fams = bySeed.get(k) ?? new Map<FamilySlug, Set<string>>();
      const seeds = fams.get(speaks) ?? new Set<string>();
      // A seed shared by a family mix and its sub-genre mix counts once.
      seeds.add(r.seed);
      fams.set(speaks, seeds);
      bySeed.set(k, fams);
    }
  }
  const out = new Map<string, FamilySlug>();
  for (const k of signalled) out.set(k, 'game-anime');
  for (const [k, fams] of bySeed) {
    if (out.has(k)) continue;
    const ga = fams.get('game-anime')?.size ?? 0;
    let best: FamilySlug | null = null;
    let top = 0;
    let tie = false;
    for (const [f, seeds] of fams) {
      if (f === 'game-anime') continue;
      if (seeds.size > top) {
        best = f;
        top = seeds.size;
        tie = false;
      } else if (seeds.size === top) {
        tie = true;
      }
    }
    if (ga >= UNTAGGED_MIN_RADIOS_GAME_ANIME && ga >= top) out.set(k, 'game-anime');
    else if (best && top >= UNTAGGED_MIN_RADIOS && !tie) out.set(k, best);
  }
  return out;
}
