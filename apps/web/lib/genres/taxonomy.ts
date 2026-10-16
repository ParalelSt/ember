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

// ---------------------------------------------------------------------------
// Raw tags (Last.fm, MusicBrainz) to families.

/** Where one raw tag points: a family, and the half of it when it has one. */
export interface TagTarget {
  family: FamilySlug;
  sub?: SubSlug;
}

/** Exact tags first (lowercased, "-" and "_" read as spaces). */
const EXACT: Record<string, TagTarget> = {
  'rock': { family: 'rock-metal', sub: 'rock' },
  'alternative': { family: 'rock-metal', sub: 'rock' },
  'alternative rock': { family: 'rock-metal', sub: 'rock' },
  'indie': { family: 'rock-metal', sub: 'rock' },
  'indie rock': { family: 'rock-metal', sub: 'rock' },
  'punk': { family: 'rock-metal', sub: 'rock' },
  'grunge': { family: 'rock-metal', sub: 'rock' },
  'classic rock': { family: 'rock-metal', sub: 'rock' },
  'hard rock': { family: 'rock-metal', sub: 'metal' },
  'post grunge': { family: 'rock-metal', sub: 'rock' },
  'emo': { family: 'rock-metal', sub: 'rock' },
  'djent': { family: 'rock-metal', sub: 'metal' },
  'pop': { family: 'pop' },
  'dance pop': { family: 'pop' },
  'synthpop': { family: 'pop' },
  'synth pop': { family: 'pop' },
  'electropop': { family: 'pop' },
  'k pop': { family: 'pop' },
  'kpop': { family: 'pop' },
  'teen pop': { family: 'pop' },
  'pop rock': { family: 'pop' },
  'indie pop': { family: 'pop' },
  'latin pop': { family: 'latin' },
  'balkan pop': { family: 'balkan' },
  'hip hop': { family: 'hiphop-rnb', sub: 'hiphop' },
  'hiphop': { family: 'hiphop-rnb', sub: 'hiphop' },
  'rap': { family: 'hiphop-rnb', sub: 'hiphop' },
  'trap': { family: 'hiphop-rnb', sub: 'hiphop' },
  'drill': { family: 'hiphop-rnb', sub: 'hiphop' },
  'rnb': { family: 'hiphop-rnb', sub: 'rnb' },
  'r&b': { family: 'hiphop-rnb', sub: 'rnb' },
  'r and b': { family: 'hiphop-rnb', sub: 'rnb' },
  'soul': { family: 'hiphop-rnb', sub: 'rnb' },
  'neo soul': { family: 'hiphop-rnb', sub: 'rnb' },
  'contemporary r&b': { family: 'hiphop-rnb', sub: 'rnb' },
  'electronic': { family: 'electronic' },
  'electronica': { family: 'electronic' },
  'edm': { family: 'electronic' },
  'house': { family: 'electronic' },
  'techno': { family: 'electronic' },
  'trance': { family: 'electronic' },
  'dubstep': { family: 'electronic' },
  'drum and bass': { family: 'electronic' },
  'dnb': { family: 'electronic' },
  'dance': { family: 'electronic' },
  'latin': { family: 'latin' },
  'reggaeton': { family: 'latin' },
  'bachata': { family: 'latin' },
  'salsa': { family: 'latin' },
  'cumbia': { family: 'latin' },
  'turbo folk': { family: 'balkan' },
  'turbofolk': { family: 'balkan' },
  'narodna': { family: 'balkan' },
  'narodna muzika': { family: 'balkan' },
  'ex yu': { family: 'balkan' },
  'exyu': { family: 'balkan' },
  'yugoslav': { family: 'balkan' },
  'yugoslavia': { family: 'balkan' },
  'serbian': { family: 'balkan' },
  'croatian': { family: 'balkan' },
  'bosnian': { family: 'balkan' },
  'montenegrin': { family: 'balkan' },
  'macedonian': { family: 'balkan' },
  'sevdah': { family: 'balkan' },
  'sevdalinka': { family: 'balkan' },
  'balkan': { family: 'balkan' },
  'country': { family: 'country-folk' },
  'americana': { family: 'country-folk' },
  'folk': { family: 'country-folk' },
  'singer songwriter': { family: 'country-folk' },
  'acoustic': { family: 'country-folk' },
  'bluegrass': { family: 'country-folk' },
  'jazz': { family: 'jazz-blues' },
  'blues': { family: 'jazz-blues' },
  'swing': { family: 'jazz-blues' },
  'smooth jazz': { family: 'jazz-blues' },
  'classical': { family: 'classical' },
  'soundtrack': { family: 'classical' },
  'score': { family: 'classical' },
  'opera': { family: 'classical' },
  'orchestral': { family: 'classical' },
};

/** Then keywords inside longer tags, first match wins: "melodic death
 *  metal", "deep house", "serbian rap" (a country tag beats the style:
 *  Balkan rap goes in the Balkan mix). Order matters. */
const KEYWORDS: readonly [RegExp, TagTarget][] = [
  [/\b(turbo ?folk|narodn\w*|ex ?yu|yugo\w*|serbian|croatian|bosnian|montenegrin|macedonian|sevdah|sevdalinka|balkan)\b/, { family: 'balkan' }],
  [/\b(metal\w*|grindcore|deathcore|thrash|doom|sludge|djent|hard rock)\b/, { family: 'rock-metal', sub: 'metal' }],
  [/\b(hip hop|rap|trap|drill|grime|boom bap)\b/, { family: 'hiphop-rnb', sub: 'hiphop' }],
  [/\b(r&b|rnb|soul|funk)\b/, { family: 'hiphop-rnb', sub: 'rnb' }],
  [/\b(reggaeton|latin\w*|bachata|salsa|cumbia|dembow|corridos?)\b/, { family: 'latin' }],
  [/\b(house|techno|trance|edm|dubstep|electro\w*|drum and bass|dnb|ambient|idm|synthwave|hardstyle)\b/, { family: 'electronic' }],
  [/\b(rock|punk|grunge|shoegaze|post punk|emo)\b/, { family: 'rock-metal', sub: 'rock' }],
  [/\b(pop)\b/, { family: 'pop' }],
  [/\b(country|americana|folk|bluegrass|singer songwriter)\b/, { family: 'country-folk' }],
  [/\b(jazz|blues|swing|bebop)\b/, { family: 'jazz-blues' }],
  [/\b(classical|baroque|opera|orchestral|soundtrack|film score|symphon\w*)\b/, { family: 'classical' }],
];

/** "Hip-Hop", "hip_hop " -> "hip hop". */
export function normalizeTag(tag: string): string {
  return String(tag ?? '').toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The family a raw tag points at, or null for noise ("seen live",
 *  "female vocalists", "90s", "german", "favorites"). */
export function mapTag(tag: string): TagTarget | null {
  const t = normalizeTag(tag);
  if (!t) return null;
  const exact = EXACT[t];
  if (exact) return exact;
  for (const [re, target] of KEYWORDS) if (re.test(t)) return target;
  return null;
}

export interface RawTag {
  name: string;
  /** Weight from the source: Last.fm 0..100, MusicBrainz vote counts. */
  count: number;
}

/** A secondary family is kept when it weighs at least this share of the
 *  primary one. */
export const SECONDARY_SHARE = 0.6;

export interface TagVerdict {
  /** The heaviest family, null when no tag maps anywhere. */
  family: FamilySlug | null;
  /** The primary family and every secondary one, weight relative to the
   *  primary (primary = 1). */
  families: Partial<Record<FamilySlug, number>>;
  /** The heavier half of the primary family, when its tags say. */
  sub: SubSlug | null;
}

/** Sum the tags per family and pick the primary one (and the secondaries
 *  within SECONDARY_SHARE of it). A tag with no count weighs 1. Ties go to
 *  the family whose tags came first (sources list the strongest first). */
export function classifyTags(tags: readonly RawTag[]): TagVerdict {
  const weight = new Map<FamilySlug, number>();
  const subWeight = new Map<SubSlug, number>();
  for (const tag of tags) {
    const target = mapTag(tag.name);
    if (!target) continue;
    const w = Number.isFinite(tag.count) && tag.count > 0 ? tag.count : 1;
    weight.set(target.family, (weight.get(target.family) ?? 0) + w);
    if (target.sub) subWeight.set(target.sub, (subWeight.get(target.sub) ?? 0) + w);
  }
  let family: FamilySlug | null = null;
  let top = 0;
  for (const [f, w] of weight) {
    if (w > top) {
      family = f;
      top = w;
    }
  }
  if (!family) return { family: null, families: {}, sub: null };
  const families: Partial<Record<FamilySlug, number>> = {};
  for (const [f, w] of weight) {
    if (f === family || w >= top * SECONDARY_SHARE) families[f] = Math.round((w / top) * 1000) / 1000;
  }
  const subs = familyOf(family)?.subs ?? [];
  let sub: SubSlug | null = null;
  let subTop = 0;
  for (const s of subs) {
    const w = subWeight.get(s.slug) ?? 0;
    if (w > subTop) {
      sub = s.slug;
      subTop = w;
    }
  }
  return { family, families, sub };
}
