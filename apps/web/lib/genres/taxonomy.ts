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

/** The narrower styles a family splits into (docs/mixes.md, "Style
 *  mixes"). rock, metal, hiphop and rnb are the original halves; the rest
 *  came with the smaller style mixes. */
export type SubSlug =
  | 'rock' | 'metal' | 'punk' | 'indie'
  | 'kpop' | 'indie-pop'
  | 'hiphop' | 'rnb'
  | 'house' | 'techno' | 'dnb' | 'ambient'
  | 'reggaeton' | 'tropical'
  | 'turbofolk' | 'balkan-rock' | 'balkan-hiphop' | 'balkan-pop'
  | 'country' | 'folk'
  | 'jazz' | 'blues'
  | 'soundtrack';

export interface SubGenre {
  slug: SubSlug;
  name: string;
  tint: string;
  /** Tested against every normalized tag of an artist in the family; a tag
   *  counts for the first sub-genre (in list order) it matches. */
  match: RegExp;
}

export interface Family {
  slug: FamilySlug;
  /** Display name, also the mix's name: "Rock & Metal". */
  name: string;
  color: string;
  tint: string;
  /** Text on `tint`. */
  ink: string;
  subs?: readonly SubGenre[];
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
      { slug: 'metal', name: 'Metal', tint: '#c9c3d6', match: /\b(metal\w*|grindcore|deathcore|thrash|doom|sludge|djent|hard rock)\b/ },
      { slug: 'punk', name: 'Punk', tint: '#f5d36b', match: /\b(punk|emo|hardcore|ska)\b/ },
      { slug: 'indie', name: 'Indie', tint: '#b9dfc4', match: /\b(indie|shoegaze|dream pop|post rock|math rock|lo fi)\b/ },
      { slug: 'rock', name: 'Rock', tint: '#f4c2a1', match: /\b(rock|alternative|grunge|blues rock|psychedelic)\b/ },
    ],
  },
  {
    slug: 'pop',
    name: 'Pop',
    color: '#c2185b',
    tint: '#f7c1dc',
    ink: INK,
    subs: [
      { slug: 'kpop', name: 'K-Pop', tint: '#ffc8e6', match: /\b(k ?pop|korean|j ?pop|japanese)\b/ },
      { slug: 'indie-pop', name: 'Indie Pop', tint: '#d7e8b5', match: /\b(indie|bedroom pop|dream pop|art pop|chamber pop)\b/ },
    ],
  },
  {
    slug: 'hiphop-rnb',
    name: 'Hip-hop & R&B',
    color: '#6a3fb5',
    tint: '#d4c4f2',
    ink: INK,
    subs: [
      { slug: 'hiphop', name: 'Hip-hop', tint: '#cdd3f5', match: /\b(hip ?hop|rap|trap|drill|grime|boom bap)\b/ },
      { slug: 'rnb', name: 'R&B', tint: '#ecc8e8', match: /\b(r&b|rnb|r and b|soul|funk)\b/ },
    ],
  },
  {
    slug: 'electronic',
    name: 'Electronic',
    color: '#0b7a8a',
    tint: '#b5e6ec',
    ink: INK,
    subs: [
      { slug: 'dnb', name: 'Drum & Bass', tint: '#c6e9b0', match: /\b(drum and bass|dnb|jungle|dubstep|bass music|liquid)\b/ },
      { slug: 'techno', name: 'Techno', tint: '#c4cbd6', match: /\b(techno|industrial|hardstyle|trance)\b/ },
      { slug: 'house', name: 'House', tint: '#ffd9b3', match: /\b(house|disco|garage|edm|dance|big room)\b/ },
      { slug: 'ambient', name: 'Chill Electronic', tint: '#cfe3f7', match: /\b(ambient|chill\w*|downtempo|idm|lo fi|synthwave|trip hop)\b/ },
    ],
  },
  {
    slug: 'latin',
    name: 'Latin',
    color: '#d9480f',
    tint: '#ffd3a8',
    ink: INK,
    subs: [
      { slug: 'reggaeton', name: 'Reggaeton', tint: '#ffc2a8', match: /\b(reggaeton|latin trap|dembow|urbano|perreo)\b/ },
      { slug: 'tropical', name: 'Salsa & Bachata', tint: '#ffe6a3', match: /\b(salsa|bachata|cumbia|merengue|tropical)\b/ },
    ],
  },
  {
    slug: 'balkan',
    name: 'Balkan',
    color: '#1f5fa8',
    tint: '#bcd6f5',
    ink: INK,
    subs: [
      { slug: 'balkan-hiphop', name: 'Balkan Rap', tint: '#cbc8f2', match: /\b(hip ?hop|rap|trap|drill)\b/ },
      { slug: 'balkan-rock', name: 'Ex-YU Rock', tint: '#f3c4b5', match: /\b(rock|punk|new wave|metal|grunge)\b/ },
      { slug: 'turbofolk', name: 'Narodna', tint: '#f6dca0', match: /\b(turbo ?folk|narodn\w*|folk|sevdah\w*|sevdalinka|starogradsk\w*)\b/ },
      { slug: 'balkan-pop', name: 'Balkan Pop', tint: '#c5e4f0', match: /\b(pop|dance|schlager)\b/ },
    ],
  },
  {
    slug: 'country-folk',
    name: 'Country & Folk',
    color: '#8a5a1c',
    tint: '#ecd9b0',
    ink: INK,
    subs: [
      { slug: 'country', name: 'Country', tint: '#f0cfa0', match: /\b(country|americana|bluegrass|honky tonk)\b/ },
      { slug: 'folk', name: 'Folk', tint: '#d6e2bf', match: /\b(folk|singer songwriter|acoustic)\b/ },
    ],
  },
  {
    slug: 'jazz-blues',
    name: 'Jazz & Blues',
    color: '#2d5a3d',
    tint: '#c3e3c9',
    ink: INK,
    subs: [
      { slug: 'blues', name: 'Blues', tint: '#bfd4ea', match: /\b(blues)\b/ },
      { slug: 'jazz', name: 'Jazz', tint: '#d8e8b8', match: /\b(jazz|swing|bebop|bossa nova)\b/ },
    ],
  },
  {
    slug: 'classical',
    name: 'Classical',
    color: '#5b5b73',
    tint: '#dcdce8',
    ink: INK,
    subs: [
      { slug: 'soundtrack', name: 'Soundtracks', tint: '#e3d6f0', match: /\b(soundtrack|score|film|video game|game music)\b/ },
    ],
  },
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

/** Where one raw tag points: a family. The sub-genre is read separately,
 *  from all of an artist's tags (subOfTags). */
export interface TagTarget {
  family: FamilySlug;
}

/** Exact tags first (lowercased, "-" and "_" read as spaces). */
const EXACT: Record<string, TagTarget> = {
  'rock': { family: 'rock-metal' },
  'alternative': { family: 'rock-metal' },
  'alternative rock': { family: 'rock-metal' },
  'indie': { family: 'rock-metal' },
  'indie rock': { family: 'rock-metal' },
  'punk': { family: 'rock-metal' },
  'grunge': { family: 'rock-metal' },
  'classic rock': { family: 'rock-metal' },
  'hard rock': { family: 'rock-metal' },
  'post grunge': { family: 'rock-metal' },
  'emo': { family: 'rock-metal' },
  'djent': { family: 'rock-metal' },
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
  'hip hop': { family: 'hiphop-rnb' },
  'hiphop': { family: 'hiphop-rnb' },
  'rap': { family: 'hiphop-rnb' },
  'trap': { family: 'hiphop-rnb' },
  'drill': { family: 'hiphop-rnb' },
  'rnb': { family: 'hiphop-rnb' },
  'r&b': { family: 'hiphop-rnb' },
  'r and b': { family: 'hiphop-rnb' },
  'soul': { family: 'hiphop-rnb' },
  'neo soul': { family: 'hiphop-rnb' },
  'contemporary r&b': { family: 'hiphop-rnb' },
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
  [/\b(metal\w*|grindcore|deathcore|thrash|doom|sludge|djent|hard rock)\b/, { family: 'rock-metal' }],
  [/\b(hip hop|rap|trap|drill|grime|boom bap)\b/, { family: 'hiphop-rnb' }],
  [/\b(r&b|rnb|soul|funk)\b/, { family: 'hiphop-rnb' }],
  [/\b(reggaeton|latin\w*|bachata|salsa|cumbia|dembow|corridos?)\b/, { family: 'latin' }],
  [/\b(house|techno|trance|edm|dubstep|electro\w*|drum and bass|dnb|ambient|idm|synthwave|hardstyle)\b/, { family: 'electronic' }],
  [/\b(rock|punk|grunge|shoegaze|post punk|emo)\b/, { family: 'rock-metal' }],
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
  /** The primary family's heaviest sub-genre, when its tags say. */
  sub: SubSlug | null;
}

/** Sum the tags per family and pick the primary one (and the secondaries
 *  within SECONDARY_SHARE of it). A tag with no count weighs 1. Ties go to
 *  the family whose tags came first (sources list the strongest first). */
export function classifyTags(tags: readonly RawTag[]): TagVerdict {
  const weight = new Map<FamilySlug, number>();
  for (const tag of tags) {
    const target = mapTag(tag.name);
    if (!target) continue;
    weight.set(target.family, (weight.get(target.family) ?? 0) + tagWeight(tag));
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
  return { family, families, sub: subOfTags(family, tags) };
}

const tagWeight = (tag: RawTag) => (Number.isFinite(tag.count) && tag.count > 0 ? tag.count : 1);

/** The heaviest sub-genre of `family` the tags name, or null. Every tag
 *  counts (a Balkan band's plain "rock" tag makes it Ex-YU Rock), each for
 *  the first sub-genre it matches; ties go to the sub-genre listed first. */
export function subOfTags(family: FamilySlug | null, tags: readonly RawTag[]): SubSlug | null {
  const subs = familyOf(family)?.subs;
  if (!subs?.length) return null;
  const weight = new Map<SubSlug, number>();
  for (const tag of tags) {
    const t = normalizeTag(tag.name);
    if (!t || t.startsWith('chart:')) continue;
    const hit = subs.find((s) => s.match.test(t));
    if (hit) weight.set(hit.slug, (weight.get(hit.slug) ?? 0) + tagWeight(tag));
  }
  let sub: SubSlug | null = null;
  let top = 0;
  for (const s of subs) {
    const w = weight.get(s.slug) ?? 0;
    if (w > top) {
      sub = s.slug;
      top = w;
    }
  }
  return sub;
}

const SUB_SLUGS = new Set<string>(FAMILIES.flatMap((f) => (f.subs ?? []).map((s) => s.slug)));

export function isSubSlug(slug: unknown): slug is SubSlug {
  return typeof slug === 'string' && SUB_SLUGS.has(slug);
}
