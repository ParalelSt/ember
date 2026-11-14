import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import type { FamilySlug } from '../genres/taxonomy';
import type { Track } from '../../types/track';
import { MIN_MIX_SIZE, MIX_SIZE, PER_ARTIST_MAX, weave, type GenreOf, type MixMeta } from './build';
import { artistDisplayName, artistMixKey } from './kinds';
import type { ArtistScore, SongScore } from './score';

/** Artist mixes (docs/mixes.md): "Gojira Mix", one per top artist, made of
 *  that artist's songs the member plays and the radio of a few of them
 *  (their other songs and similar artists). Pure. */

/** What an artist needs for a mix: three different songs and this much
 *  play weight (about three recent plays). */
export const ARTIST_MIN_SONGS = 3;
export const ARTIST_MIN_WEIGHT = 3;
export const ARTIST_SEEDS = 3;
/** The member's own songs by the artist at the front of the mix. */
export const ARTIST_KNOWN_MAX = 10;
/** Most songs by the artist in their own mix; similar artists keep the
 *  usual PER_ARTIST_MAX. */
export const ARTIST_OWN_MAX = 12;

export interface ArtistPlan {
  /** The mix key, "artist-gojira". */
  key: string;
  artistKey: string;
  /** "Gojira" (the lead artist of the credit). */
  name: string;
  family: FamilySlug | null;
  weight: number;
  /** Their songs the member plays, best first. */
  songs: SongScore[];
}

/** The artist's name as most of their songs credit it (ties: the better
 *  song's), cleaned of " - Topic" and VEVO, so the mix's name and key stay
 *  the same night after night whichever song is on top. */
function commonCredit(a: ArtistScore): string {
  const count = new Map<string, number>();
  for (const s of a.songs) {
    const n = artistDisplayName(s.track.artist);
    if (n) count.set(n, (count.get(n) ?? 0) + 1);
  }
  let best = '';
  let top = 0;
  for (const [n, c] of count) {
    if (c > top) {
      best = n;
      top = c;
    }
  }
  return best;
}

/** The member's artist mixes, best artist first, at most `max`. */
export function artistPlans(artists: readonly ArtistScore[], genres: ReadonlyMap<string, GenreOf>, max: number): ArtistPlan[] {
  const out: ArtistPlan[] = [];
  const keys = new Set<string>();
  for (const a of artists) {
    if (out.length >= max) break;
    if (a.score < ARTIST_MIN_WEIGHT) continue;
    if (new Set(a.songs.map((s) => s.key)).size < ARTIST_MIN_SONGS) continue;
    if (!a.songs.some((s) => s.track.source === 'youtube')) continue;
    const name = commonCredit(a) || a.name;
    const key = artistMixKey(name);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({ key, artistKey: a.key, name, family: genres.get(a.key)?.family ?? null, weight: a.score, songs: a.songs });
  }
  return out;
}

export interface ArtistAssembleInput {
  plan: ArtistPlan;
  radios: readonly { seed: string; tracks: readonly Track[] }[];
  genres: ReadonlyMap<string, GenreOf>;
  unavailable: ReadonlySet<string>;
  /** Songs the member blocked. */
  skip?: (t: Track) => boolean;
}

/** Whether a radio song's artist fits next to the featured one: unknown
 *  artists do (the radio picked them), a known one only from the same
 *  family, and an admin's "no family" never. */
export function fitsArtist(family: FamilySlug | null, g: GenreOf | undefined): boolean {
  if (!g) return true;
  if (!g.family) return !g.manual;
  return !family || g.family === family;
}

/** The mix's tracks, or null when fewer than MIN_MIX_SIZE survive. */
export function assembleArtistMix({ plan, radios, genres, unavailable, skip = () => false }: ArtistAssembleInput): Track[] | null {
  const perArtist = new Map<string, number>();
  const used = new Set<string>();
  const capOf = (k: string) => (k === plan.artistKey ? ARTIST_OWN_MAX : PER_ARTIST_MAX);
  const room = (k: string) => (perArtist.get(k) ?? 0) < capOf(k);
  const take = (t: Track, k: string) => {
    perArtist.set(k, (perArtist.get(k) ?? 0) + 1);
    used.add(songKey(t));
  };

  const known: Track[] = [];
  for (const s of plan.songs) {
    if (known.length >= ARTIST_KNOWN_MAX) break;
    if (unavailable.has(s.track.id) || skip(s.track) || used.has(s.key)) continue;
    take(s.track, plan.artistKey);
    known.push(s.track);
  }

  const pool: Track[] = [];
  const longest = Math.max(0, ...radios.map((r) => r.tracks.length));
  for (let i = 0; i < longest; i++) for (const r of radios) if (r.tracks[i]) pool.push(r.tracks[i]);

  const fresh: Track[] = [];
  for (const t of pool) {
    if (known.length + fresh.length >= MIX_SIZE) break;
    if (!t || unavailable.has(t.id) || skip(t)) continue;
    if (used.has(songKey(t))) continue;
    const k = artistKey(t.artist);
    if (!k || !room(k)) continue;
    if (k !== plan.artistKey && !fitsArtist(plan.family, genres.get(k))) continue;
    take(t, k);
    fresh.push(t);
  }
  const tracks = weave(known, fresh, MIX_SIZE);
  return tracks.length >= MIN_MIX_SIZE ? tracks : null;
}

/** The card: the artist's name, the artist and the two artists heard most
 *  next to them, each with a cover. */
export function describeArtistMix(plan: ArtistPlan, tracks: readonly Track[], color: string): MixMeta {
  const others = new Map<string, { name: string; count: number; art: string | null }>();
  for (const t of tracks) {
    const k = artistKey(t.artist);
    if (!k || k === plan.artistKey) continue;
    const o = others.get(k) ?? { name: artistDisplayName(t.artist), count: 0, art: null };
    o.count += 1;
    o.art ??= t.artworkUrl ?? null;
    others.set(k, o);
  }
  const top = [...others.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 2);
  const own = plan.songs.find((s) => s.track.artworkUrl)?.track.artworkUrl ?? tracks.find((t) => artistKey(t.artist) === plan.artistKey)?.artworkUrl;
  const art = [own, ...top.map((o) => o.art)].filter((u): u is string => !!u);
  return {
    title: plan.name,
    subtitle: `${[plan.name, ...top.map((o) => o.name)].join(', ')} and more`,
    artworkUrls: [...new Set(art)].slice(0, 3),
    color,
  };
}
