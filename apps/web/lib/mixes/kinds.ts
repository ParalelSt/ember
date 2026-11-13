import { firstArtist } from '../genres/artistKey';
import { FAMILIES, mixLook } from '../genres/taxonomy';

/** The five kinds of personal mix (docs/mixes.md) and everything about
 *  them that the server and the client share: keys, labels, titles,
 *  colours, Home caps and order. Pure, no I/O.
 *
 *  A mix's kind is read from its key, so the `mixes` collection needs no
 *  new field: a family or sub-genre slug is a style mix, "artist-..." an
 *  artist mix, and three fixed keys are the rest. */

export type MixKind = 'style' | 'discover' | 'on-repeat' | 'artist' | 'throwback';

export const DISCOVER_KEY = 'discover';
export const ON_REPEAT_KEY = 'on-repeat';
export const THROWBACK_KEY = 'throwback';
export const ARTIST_KEY_PREFIX = 'artist-';

/** Most mixes on Home. */
export const MAX_MIXES = 12;

/** How many of each kind make the twelve. The base caps add up to twelve;
 *  when a kind has fewer, its free slots go to more style mixes (up to
 *  `max`), then more artist mixes, so a member with three styles still
 *  gets a full row but twelve artist mixes never crowd out the rest. */
export const KIND_CAPS: Record<MixKind, { base: number; max: number }> = {
  style: { base: 5, max: 7 },
  discover: { base: 1, max: 1 },
  'on-repeat': { base: 1, max: 1 },
  artist: { base: 4, max: 6 },
  throwback: { base: 1, max: 1 },
};

/** Home order, kind by kind. */
export const KIND_ORDER: readonly MixKind[] = ['style', 'discover', 'on-repeat', 'artist', 'throwback'];

/** Stored positions are banded by kind (style 0-9, Discover 10, ...), so a
 *  mix kept from an earlier build (Discover, rebuilt weekly) still sorts
 *  into its place when the others change. */
const KIND_BAND: Record<MixKind, number> = { style: 0, discover: 10, 'on-repeat': 20, artist: 30, throwback: 40 };

export function mixPosition(kind: MixKind, index: number): number {
  return KIND_BAND[kind] + Math.min(Math.max(0, index), 9);
}

export function mixKind(key: string): MixKind {
  if (key === DISCOVER_KEY) return 'discover';
  if (key === ON_REPEAT_KEY) return 'on-repeat';
  if (key === THROWBACK_KEY) return 'throwback';
  if (key.startsWith(ARTIST_KEY_PREFIX)) return 'artist';
  return 'style';
}

/** The small label top right on the card and above the title on the mix
 *  page. */
export const KIND_LABEL: Record<MixKind, string> = {
  style: 'MIX',
  discover: 'DISCOVER',
  'on-repeat': 'ON REPEAT',
  artist: 'ARTIST MIX',
  throwback: 'THROWBACK',
};

/** The big words on the card for the kinds whose title is fixed. */
export const FIXED_TITLE: Partial<Record<MixKind, string>> = {
  discover: 'New to you',
  'on-repeat': 'Your top songs',
  throwback: 'Back again',
};

/** The mix's full name for the page heading, the quick grid, the player
 *  and a saved playlist: "Rock Mix", "Gojira Mix", "New to you". */
export function mixFullTitle(key: string, title: string): string {
  const kind = mixKind(key);
  return kind === 'style' || kind === 'artist' ? `${title} Mix` : title;
}

/** The mix page's refresh note. */
export function refreshNote(key: string): string {
  return mixKind(key) === 'discover' ? 'New every Monday' : 'Rebuilt every night';
}

const INK = '#141414';

/** Fixed card colours for the kinds that have no genre. */
export const KIND_TINT: Partial<Record<MixKind, string>> = {
  discover: '#c9f0a8',
  'on-repeat': '#ffc9a3',
  throwback: '#e6d9bf',
};

/** A card's colour and the text on it. Style mixes take their genre's
 *  tint, artist mixes the tint stored at build time (their family's),
 *  the rest a fixed one. */
export function kindLook(key: string, stored?: string): { color: string; ink: string } {
  const kind = mixKind(key);
  if (kind === 'style') return { color: stored || mixLook(key).tint, ink: mixLook(key).ink };
  return { color: stored || KIND_TINT[kind] || artistTint(key, null), ink: INK };
}

const ARTIST_TINTS = FAMILIES.map((f) => f.tint);

/** An artist mix's colour: their family's tint, or (family unknown) one of
 *  the family tints picked by the key, the same one every night. */
export function artistTint(key: string, familyTint: string | null): string {
  return familyTint || ARTIST_TINTS[hash(key) % ARTIST_TINTS.length];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "artist-" plus a URL-safe slug of the lead artist's name ("Đorđe
 *  Balašević" -> "artist-dorde-balasevic"), at most 40 characters in all
 *  (the collection's key limit). A name with no Latin letters (Цеца) gets
 *  a stable hash instead. */
export function artistMixKey(name: string): string {
  const lead = firstArtist(name);
  const slug = lead
    .replace(/\s*-\s*topic\s*$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return `${ARTIST_KEY_PREFIX}${slug || hash(lead.toLowerCase()).toString(36)}`;
}

/** The twelve (at most) mixes in Home order, from candidates per kind (each
 *  list best first). Base caps first; free slots to style, then artist, up
 *  to their max. */
export function lineup<T>(byKind: Partial<Record<MixKind, readonly T[]>>, max = MAX_MIXES): { kind: MixKind; item: T; index: number }[] {
  const take: Record<MixKind, number> = { style: 0, discover: 0, 'on-repeat': 0, artist: 0, throwback: 0 };
  const have = (k: MixKind) => byKind[k]?.length ?? 0;
  let used = 0;
  for (const k of KIND_ORDER) {
    take[k] = Math.min(have(k), KIND_CAPS[k].base);
    used += take[k];
  }
  for (const k of ['style', 'artist'] as const) {
    const extra = Math.max(0, Math.min(have(k), KIND_CAPS[k].max) - take[k]);
    const add = Math.min(extra, Math.max(0, max - used));
    take[k] += add;
    used += add;
  }
  const out: { kind: MixKind; item: T; index: number }[] = [];
  for (const k of KIND_ORDER) {
    (byKind[k] ?? []).slice(0, take[k]).forEach((item, index) => out.push({ kind: k, item, index }));
  }
  return out.slice(0, max);
}
