import { familyOf, type FamilySlug, type SubSlug } from '../genres/taxonomy';
import type { SongScore } from './score';

/** Which style mixes a member gets (docs/mixes.md): their songs grouped by
 *  their artist's primary family and, inside it, by sub-genre. Pure. */

/** Total play weight (about 10 recent plays, likes count 2) before a member
 *  gets any style mix. */
export const MEMBER_MIN_WEIGHT = 10;
/** What a family or a sub-genre needs to be a mix: this much weight, three
 *  different songs and two artists. */
export const FAMILY_MIN_WEIGHT = 4;
export const FAMILY_MIN_SONGS = 3;
export const FAMILY_MIN_ARTISTS = 2;
/** A family's only qualifying sub-genre is a mix of its own next to the
 *  family mix only when it is at most this share of the family, so "Rock
 *  & Metal" and a "Metal" that is 95% of it do not both show up. */
export const SUB_MAX_SHARE = 0.8;
/** Most style plans clusterMember returns (lib/mixes/kinds STYLE_MAX). */
export const MAX_STYLE_PLANS = 7;

/** What the cluster needs to know of an artist: their primary family and
 *  their sub-genre in it. */
export interface ArtistFamily {
  family: FamilySlug | null;
  sub: SubSlug | null;
}

export interface MixPlan {
  /** The mix key: a family slug, or a sub-genre slug. */
  key: string;
  family: FamilySlug;
  /** Set for a sub-genre mix ("metal", "turbofolk"). */
  sub: SubSlug | null;
  weight: number;
  /** The member's songs in it, best first. */
  songs: SongScore[];
  /** Its artist keys, heaviest first. */
  artists: string[];
}

export interface ClusterResult {
  /** Enough listening for style mixes at all. */
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

/** One family's style mixes:
 *  - no qualifying sub-genre: the family mix;
 *  - one: the family mix, plus the sub-genre when it is at most
 *    SUB_MAX_SHARE of the family;
 *  - two or more: each of them, plus the family mix when the songs outside
 *    them qualify on their own; otherwise songs whose sub-genre is unknown
 *    join the heaviest sub-genre mix (the old halves rule). */
function familyPlans(family: FamilySlug, list: SongScore[], genres: ReadonlyMap<string, ArtistFamily>): MixPlan[] {
  const whole = plan(family, family, null, list);
  if (!isEligible(whole)) return [];
  const subs = familyOf(family)?.subs ?? [];
  const subOf = (s: SongScore) => genres.get(s.artistKey)?.sub ?? null;
  const qualifying = subs
    .map((sub) => plan(sub.slug, family, sub.slug, list.filter((s) => subOf(s) === sub.slug)))
    .filter(isEligible)
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  if (qualifying.length === 0) return [whole];
  if (qualifying.length === 1) {
    return qualifying[0].weight <= whole.weight * SUB_MAX_SHARE ? [whole, qualifying[0]] : [whole];
  }
  const taken = new Set(qualifying.map((p) => p.sub));
  const rest = list.filter((s) => !taken.has(subOf(s)));
  if (isEligible(plan(family, family, null, rest))) return [whole, ...qualifying];
  const unknown = list.filter((s) => subOf(s) === null);
  const [heaviest, ...others] = qualifying;
  return [plan(heaviest.key, family, heaviest.sub, [...heaviest.songs, ...unknown]), ...others];
}

/** The member's style mixes, at most MAX_STYLE_PLANS. For variety, every
 *  family's heaviest mix comes first (heaviest family first), then the
 *  rest by weight, so one family's sub-genres never crowd out a second
 *  family. */
export function clusterMember(songs: readonly SongScore[], genres: ReadonlyMap<string, ArtistFamily>): ClusterResult {
  const total = songs.reduce((n, s) => n + s.score, 0);
  if (total < MEMBER_MIN_WEIGHT) return { eligible: false, total, mixes: [] };
  const byFamily = new Map<FamilySlug, SongScore[]>();
  for (const s of songs) {
    const fam = genres.get(s.artistKey)?.family;
    if (!fam) continue;
    const list = byFamily.get(fam) ?? [];
    list.push(s);
    byFamily.set(fam, list);
  }
  const byWeight = (x: MixPlan, y: MixPlan) => y.weight - x.weight || x.key.localeCompare(y.key);
  const perFamily = [...byFamily].map(([family, list]) => familyPlans(family, list, genres).sort(byWeight)).filter((l) => l.length);
  const firsts = perFamily.map((l) => l[0]).sort(byWeight);
  const rest = perFamily.flatMap((l) => l.slice(1)).sort(byWeight);
  return { eligible: true, total, mixes: [...firsts, ...rest].slice(0, MAX_STYLE_PLANS) };
}
