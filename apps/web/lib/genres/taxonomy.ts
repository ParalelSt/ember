/** The fixed genre taxonomy behind "Charts by genre" and the personal genre
 *  mixes (docs/mixes.md). Pure data and pure functions, no I/O, so the
 *  server, the client and the tests share one table.
 *
 *  A family is what a mix is about ("Rock & Metal"). Charts are YouTube
 *  Music's own genre charts, each belonging to one family. Colours are fixed
 *  art, the same in every theme: `color` is the strong tile colour (white
 *  text on it), `tint` the light card colour of a mix (dark `ink` on it). */

export type FamilySlug =
  | 'rock-metal'
  | 'pop'
  | 'hiphop-rnb'
  | 'electronic'
  | 'latin'
  | 'balkan'
  | 'country-folk'
  | 'jazz-blues'
  | 'classical';

/** The halves a family may split into when someone plays plenty of both. */
export type SubSlug = 'rock' | 'metal' | 'hiphop' | 'rnb';

export interface SubGenre {
  slug: SubSlug;
  name: string;
  tint: string;
}

export interface Family {
  slug: FamilySlug;
  /** Display name, also the mix's name: "Rock & Metal". */
  name: string;
  color: string;
  tint: string;
  /** Text on `tint`. */
  ink: string;
  subs?: readonly [SubGenre, SubGenre];
}

const INK = '#141414';

export const FAMILIES: readonly Family[] = [
  {
    slug: 'rock-metal',
    name: 'Rock & Metal',
    color: '#b3261e',
    tint: '#f2b8a8',
    ink: INK,
    subs: [
      { slug: 'rock', name: 'Rock', tint: '#f4c2a1' },
      { slug: 'metal', name: 'Metal', tint: '#c9c3d6' },
    ],
  },
  { slug: 'pop', name: 'Pop', color: '#c2185b', tint: '#f7c1dc', ink: INK },
  {
    slug: 'hiphop-rnb',
    name: 'Hip-hop & R&B',
    color: '#6a3fb5',
    tint: '#d4c4f2',
    ink: INK,
    subs: [
      { slug: 'hiphop', name: 'Hip-hop', tint: '#cdd3f5' },
      { slug: 'rnb', name: 'R&B', tint: '#ecc8e8' },
    ],
  },
  { slug: 'electronic', name: 'Electronic', color: '#0b7a8a', tint: '#b5e6ec', ink: INK },
  { slug: 'latin', name: 'Latin', color: '#d9480f', tint: '#ffd3a8', ink: INK },
  { slug: 'balkan', name: 'Balkan', color: '#1f5fa8', tint: '#bcd6f5', ink: INK },
  { slug: 'country-folk', name: 'Country & Folk', color: '#8a5a1c', tint: '#ecd9b0', ink: INK },
  { slug: 'jazz-blues', name: 'Jazz & Blues', color: '#2d5a3d', tint: '#c3e3c9', ink: INK },
  { slug: 'classical', name: 'Classical', color: '#5b5b73', tint: '#dcdce8', ink: INK },
];

const FAMILY_BY_SLUG = new Map<string, Family>(FAMILIES.map((f) => [f.slug, f]));

export function familyOf(slug: string | null | undefined): Family | null {
  return (slug && FAMILY_BY_SLUG.get(slug)) || null;
}

export function isFamilySlug(slug: unknown): slug is FamilySlug {
  return typeof slug === 'string' && FAMILY_BY_SLUG.has(slug);
}

/** The family a sub-genre slug belongs to, or null. */
export function parentFamilyOf(sub: string): Family | null {
  return FAMILIES.find((f) => f.subs?.some((s) => s.slug === sub)) ?? null;
}

/** A mix key (a family or a sub-genre slug) as { name, tint, ink }. */
export function mixLook(key: string): { name: string; tint: string; ink: string; family: FamilySlug | null } {
  const fam = familyOf(key);
  if (fam) return { name: fam.name, tint: fam.tint, ink: fam.ink, family: fam.slug };
  const parent = parentFamilyOf(key);
  const sub = parent?.subs?.find((s) => s.slug === key);
  if (parent && sub) return { name: sub.name, tint: sub.tint, ink: parent.ink, family: parent.slug };
  return { name: key, tint: '#dddddd', ink: INK, family: null };
}

export interface ChartDef {
  /** player.py genre-charts' slug. */
  slug: string;
  title: string;
  family: FamilySlug;
  /** The half of a split family this chart stands for, if any. */
  sub?: SubSlug;
  /** The tile colour (white text on it). */
  color: string;
}

/** The genre charts in Home order: the Balkan chart first (most members
 *  listen there), then the US genre charts. A chart YouTube adds later
 *  that is not listed here goes last, in a neutral colour. */
export const CHARTS: readonly ChartDef[] = [
  { slug: 'balkan', title: 'Balkan', family: 'balkan', color: '#1f5fa8' },
  { slug: 'pop', title: 'Pop', family: 'pop', color: '#c2185b' },
  { slug: 'hip-hop', title: 'Hip Hop', family: 'hiphop-rnb', sub: 'hiphop', color: '#6a3fb5' },
  { slug: 'rock', title: 'Rock', family: 'rock-metal', sub: 'rock', color: '#b3261e' },
  { slug: 'hard-rock-metal', title: 'Hard Rock & Metal', family: 'rock-metal', sub: 'metal', color: '#3d3d4a' },
  { slug: 'dance-electronic', title: 'Dance & Electronic', family: 'electronic', color: '#0b7a8a' },
  { slug: 'latin', title: 'Latin', family: 'latin', color: '#d9480f' },
  { slug: 'country', title: 'Country & Americana', family: 'country-folk', color: '#8a5a1c' },
  { slug: 'jazz', title: 'Jazz', family: 'jazz-blues', color: '#2d5a3d' },
];

const CHART_BY_SLUG = new Map<string, ChartDef>(CHARTS.map((c) => [c.slug, c]));

export const UNKNOWN_CHART_COLOR = '#4a4a4a';

/** Text on a chart tile: every chart colour is dark enough for white. */
export const CHART_INK = '#ffffff';

export function chartDef(slug: string): ChartDef | null {
  return CHART_BY_SLUG.get(slug) ?? null;
}

/** Sort key for a chart slug: its CHARTS position, unknown ones last. */
export function chartOrder(slug: string): number {
  const i = CHARTS.findIndex((c) => c.slug === slug);
  return i < 0 ? CHARTS.length : i;
}

/** The charts of one family (a family can have two: Rock, Hard Rock & Metal). */
export function chartsOfFamily(family: FamilySlug): ChartDef[] {
  return CHARTS.filter((c) => c.family === family);
}
