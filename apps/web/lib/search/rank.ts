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
