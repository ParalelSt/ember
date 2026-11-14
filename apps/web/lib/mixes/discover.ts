import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import type { Track } from '../../types/track';
import { describeTracks, MIN_MIX_SIZE, pickSeeds, type MixMeta } from './build';
import { DISCOVER_KEY, FIXED_TITLE, KIND_TINT } from './kinds';
import type { ArtistScore, SongScore } from './score';

/** Discover (docs/mixes.md): songs the member has never played, from the
 *  radio of songs by artists they like, so mostly artists new to them.
 *  Rebuilt once a week (lib/mixes/job.ts keeps it until the next Monday).
 *  Pure. */

export const DISCOVER_SIZE = 30;
export const DISCOVER_SEEDS = 5;
/** Seeds come from the best song of each of this many top artists. */
export const DISCOVER_SEED_ARTISTS = 10;
export const DISCOVER_PER_ARTIST = 2;

/** The local Monday of the week `now` is in, YYYY-MM-DD: Discover's
 *  rotation and refresh key. */
export function weekKey(now: number): string {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The week's seeds: the best YouTube song of DISCOVER_SEEDS of the
 *  member's top DISCOVER_SEED_ARTISTS artists, shuffled by the week. */
export function discoverSeeds(artists: readonly ArtistScore[], week: string, ok: (s: SongScore) => boolean = () => true): SongScore[] {
  const best: SongScore[] = [];
  for (const a of artists) {
    if (best.length >= DISCOVER_SEED_ARTISTS) break;
    const s = a.songs.find((x) => x.track.source === 'youtube' && ok(x));
    if (s) best.push(s);
  }
  return pickSeeds({ key: DISCOVER_KEY, songs: best }, week, DISCOVER_SEEDS);
}

export interface DiscoverInput {
  radios: readonly { seed: string; tracks: readonly Track[] }[];
  /** songKeys the member ever played (within the history window) or liked. */
  heard: ReadonlySet<string>;
  /** Artist keys the member played or liked. */
  knownArtists: ReadonlySet<string>;
  unavailable: ReadonlySet<string>;
  skip?: (t: Track) => boolean;
}

/** New songs, artists new to the member first; their known artists'
 *  unheard songs only fill up. Null when fewer than MIN_MIX_SIZE. */
export function assembleDiscover({ radios, heard, knownArtists, unavailable, skip = () => false }: DiscoverInput): Track[] | null {
  const pool: Track[] = [];
  const longest = Math.max(0, ...radios.map((r) => r.tracks.length));
  for (let i = 0; i < longest; i++) for (const r of radios) if (r.tracks[i]) pool.push(r.tracks[i]);

  const out: Track[] = [];
  const used = new Set<string>();
  const perArtist = new Map<string, number>();
  for (const newOnly of [true, false]) {
    for (const t of pool) {
      if (out.length >= DISCOVER_SIZE) break;
      if (!t || unavailable.has(t.id) || skip(t)) continue;
      const key = songKey(t);
      if (heard.has(key) || used.has(key)) continue;
      const a = artistKey(t.artist);
      if (!a || (newOnly && knownArtists.has(a))) continue;
      if ((perArtist.get(a) ?? 0) >= DISCOVER_PER_ARTIST) continue;
      perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
      used.add(key);
      out.push(t);
    }
  }
  return out.length >= MIN_MIX_SIZE ? out : null;
}

/** The card: the first three artists in it, each with a cover. */
export function describeDiscover(tracks: readonly Track[]): MixMeta {
  return describeTracks(FIXED_TITLE.discover!, tracks, KIND_TINT.discover!);
}
