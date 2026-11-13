import type { Track } from '@/types/track';

/** Lowercase, accents gone (é → e, ö → o), whitespace collapsed. The
 *  comparison form for everything search matches on. */
export function normalizeForSearch(s: string): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only letters and digits, in any script: "AC/DC", "ac dc" and "Ac-Dc"
 *  all read "acdc". */
function compact(s: string): string {
  return normalizeForSearch(s).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The query's words, normalized; punctuation separates words too. */
export function queryWords(q: string): string[] {
  return normalizeForSearch(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Every word of the query appears somewhere in the track's title or
 *  artist (as part of a word counts: "metal" finds "Metallica"). */
export function matchesAllWords(track: Pick<Track, 'title' | 'artist'>, words: string[]): boolean {
  if (!words.length) return false;
  const hay = normalizeForSearch(`${track.title ?? ''} ${track.artist ?? ''}`);
  return words.every((w) => hay.includes(w));
}

/** Results that contain every word of the query move up; everything else
 *  keeps the order the search gave it (a stable partition, so YouTube's
 *  own ranking still decides inside each half). */
export function rankByQuery<T extends Pick<Track, 'title' | 'artist'>>(tracks: T[], q: string): T[] {
  const words = queryWords(q);
  if (!words.length) return tracks;
  const hits: T[] = [];
  const rest: T[] = [];
  for (const t of tracks) (matchesAllWords(t, words) ? hits : rest).push(t);
  return [...hits, ...rest];
}

/** Edit distance, capped: stops counting past `max` (returns max + 1). */
function distanceWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** The query IS the artist's name, give or take case, accents, spacing,
 *  punctuation, a leading "the", or a typo (one wrong letter from 6
 *  letters on, two from 12). "demetori", "Demetori " and "demetory" are
 *  direct searches for Demetori; "demetori necro fantasia" is not. */
export function isDirectArtistSearch(q: string, artistName: string): boolean {
  const query = compact(q);
  const name = compact(artistName);
  if (!query || !name) return false;
  if (query === name) return true;
  const strip = (s: string) => (s.startsWith('the') && s.length > 5 ? s.slice(3) : s);
  if (strip(query) === strip(name)) return true;
  const allowed = name.length >= 12 ? 2 : name.length >= 6 ? 1 : 0;
  return allowed > 0 && distanceWithin(query, name, allowed) <= allowed;
}

/** The listener's own songs that match the query (liked, recent searches,
 *  recently played; in the order the lists are given), at most `max`, each
 *  once. Radio stations are not songs and never match. */
export function localMatches(q: string, lists: (Track[] | null | undefined)[], max = 5): Track[] {
  const words = queryWords(q);
  if (!words.length) return [];
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const list of lists) {
    for (const t of list ?? []) {
      if (out.length >= max) return out;
      if (!t || t.source === 'station' || seen.has(t.id)) continue;
      if (!matchesAllWords(t, words)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}
