import type { Track } from '@/types/track';

/** Lowercase and strip accents so "Beyonce" finds "Beyoncé" and "dorde"
 *  finds "Đorđe". NFD drops č ć š ž to their base letters; đ has no
 *  decomposition, so it is mapped by hand. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/ð/g, 'd');
}

/** Songs whose title, artist(s) or album contain the query (case- and
 *  accent-insensitive). An empty query returns the list itself. Order is
 *  kept. */
export function filterTracks<T extends Track>(tracks: T[], query: string): T[] {
  const q = foldText(query.trim());
  if (!q) return tracks;
  return tracks.filter((t) => foldText(`${t.title}\n${t.artist}\n${t.album ?? ''}`).includes(q));
}
