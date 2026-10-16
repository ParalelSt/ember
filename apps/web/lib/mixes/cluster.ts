import { familyOf, type FamilySlug, type SubSlug } from '../genres/taxonomy';
import type { SongScore } from './score';

/** Which mixes a member gets (docs/mixes.md): their songs grouped by their
 *  artist's primary family, kept when the family weighs enough. Pure. */

/** Total play weight (about 15 recent plays, likes count 2) before a member
 *  gets any mix. */
export const MEMBER_MIN_WEIGHT = 15;
export const FAMILY_MIN_WEIGHT = 6;
export const FAMILY_MIN_SONGS = 3;
export const FAMILY_MIN_ARTISTS = 2;
export const MAX_MIXES = 6;

/** What the cluster needs to know of an artist: their primary family and
 *  the half of it they lean to. */
export interface ArtistFamily {
  family: FamilySlug | null;
  sub: SubSlug | null;
}

export interface MixPlan {
  /** The mix key: a family slug, or a sub-genre slug for a split family. */
  key: string;
  family: FamilySlug;
  /** Set for the halves of a split family ("rock", "metal"). */
  sub: SubSlug | null;
  weight: number;
  /** The member's songs in it, best first. */
  songs: SongScore[];
  /** Its artist keys, heaviest first. */
  artists: string[];
}

export interface ClusterResult {
  /** Enough listening for mixes at all. */
  eligible: boolean;
  total: number;
  mixes: MixPlan[];
}

function plan(key: string, family: FamilySlug, sub: SubSlug | null, songs: SongScore[]): MixPlan {
  const sorted = [...songs].sort((a, b) => b.score - a.score);
  const artistWeight = new Map<string, number>();
  for (const s of sorted) artistWeight.set(s.artistKey, (artistWeight.get(s.artistKey) ?? 0) + s.score);
  const artists = [...artistWeight.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { key, family, sub, weight: sorted.reduce((n, s) => n + s.score, 0), songs: sorted, artists };
}

export function isEligible(p: Pick<MixPlan, 'weight' | 'songs' | 'artists'>): boolean {
  return p.weight >= FAMILY_MIN_WEIGHT && new Set(p.songs.map((s) => s.key)).size >= FAMILY_MIN_SONGS && p.artists.length >= FAMILY_MIN_ARTISTS;
}

/** The member's mixes, heaviest first, at most MAX_MIXES. A family with two
 *  halves (Rock & Metal, Hip-hop & R&B) is split into its halves only when
 *  each half would be a mix on its own; artists whose half is unknown join
 *  the heavier half. */
export function clusterMember(songs: readonly SongScore[], genres: ReadonlyMap<string, ArtistFamily>): ClusterResult {
  const total = songs.reduce((n, s) => n + s.score, 0);
  const byFamily = new Map<FamilySlug, SongScore[]>();
  for (const s of songs) {
    const fam = genres.get(s.artistKey)?.family;
    if (!fam) continue;
    const list = byFamily.get(fam) ?? [];
    list.push(s);
    byFamily.set(fam, list);
  }
  if (total < MEMBER_MIN_WEIGHT) return { eligible: false, total, mixes: [] };

  const mixes: MixPlan[] = [];
  for (const [family, list] of byFamily) {
    const whole = plan(family, family, null, list);
    if (!isEligible(whole)) continue;
    const subs = familyOf(family)?.subs;
    if (subs) {
      const [a, b] = subs;
      const known = (s: SongScore) => genres.get(s.artistKey)?.sub ?? null;
      const weightOf = (slug: SubSlug) => list.filter((s) => known(s) === slug).reduce((n, s) => n + s.score, 0);
      const heavier = weightOf(a.slug) >= weightOf(b.slug) ? a.slug : b.slug;
      const half = (slug: SubSlug) => plan(slug, family, slug, list.filter((s) => (known(s) ?? heavier) === slug));
      const pa = half(a.slug);
      const pb = half(b.slug);
      if (isEligible(pa) && isEligible(pb)) {
        mixes.push(pa, pb);
        continue;
      }
    }
    mixes.push(whole);
  }
  mixes.sort((x, y) => y.weight - x.weight || x.key.localeCompare(y.key));
  return { eligible: true, total, mixes: mixes.slice(0, MAX_MIXES) };
}
