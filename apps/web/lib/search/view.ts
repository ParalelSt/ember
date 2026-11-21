import type { Track } from '@/types/track';
import { matchesAllWords, queryWords, rankByQuery } from './rank';
import type { SearchArtist, SearchParts } from './types';

/** Up to this many artists in the Artists section. */
export const MAX_ARTISTS = 3;
/** YouTube rows in all, as the one-shot search had: songs take up to
 *  SONG_CAP of them and videos fill the rest. */
export const YOUTUBE_TOTAL = 30;
export const SONG_CAP = 20;

export type SearchRow =
  | { kind: 'track'; key: string; track: Track }
  | { kind: 'artists'; key: string; artists: SearchArtist[] };

export interface SearchView {
  rows: SearchRow[];
  /** Every track row in display order: the queue a played result starts. */
  tracks: Track[];
  /** The Artists section is the first YouTube block (a direct artist
   *  search). */
  artistsOnTop: boolean;
}

/** What the results list shows for one query, from what has arrived so far
 *  plus the listener's own matching songs (found on the device, so they are
 *  there at once).
 *
 *  Only ever grows at the end as more arrives, so nothing already on screen
 *  moves: own matches, uploads, then (on a direct artist search) Artists,
 *  then YouTube songs (with Artists under the first few when the search is
 *  not for an artist), then videos. A group waits for the one above it, and
 *  a track already shown never shows twice. Songs and videos are each
 *  re-ranked so results with every word of the query come first.
 *
 *  When no song has every word of the query (YouTube Music's song catalog
 *  missed: "demetori" answers with other Touhou arrangers), the songs wait
 *  for the videos, which come a moment later from the same lookup, and the
 *  videos that do match go above the songs: matches move up across both,
 *  and still nothing on screen moves. */
export function buildSearchView(q: string, parts: SearchParts, own: Track[] = []): SearchView {
  const rows: SearchRow[] = [];
  const tracks: Track[] = [];
  const seen = new Set<string>();
  const add = (list: Track[], max = Infinity) => {
    let added = 0;
    for (const t of list) {
      if (added >= max) break;
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      rows.push({ kind: 'track', key: `t:${t.id}`, track: t });
      tracks.push(t);
      added++;
    }
    return added;
  };

  // Artists always lead the results (owner, 2026-11-21), above your own
  // songs and uploads too; the songs follow under them.
  // Wait for the artist lookup before showing anything, so the Artists
  // section never pushes rows that are already on screen.
  // (An error or a finished search with no artist answer shows the rest.)
  if (parts.artists === null && !parts.done && !parts.error) return { rows, tracks, artistsOnTop: false };
  const artists = (parts.artists ?? []).slice(0, MAX_ARTISTS);
  const artistsOnTop = artists.length > 0;
  if (artistsOnTop) rows.push({ kind: 'artists', key: 'artists', artists });

  add(own);
  if (parts.uploads === null) return { rows, tracks, artistsOnTop };
  add(parts.uploads);

  if (parts.songs === null) return { rows, tracks, artistsOnTop };
  const words = queryWords(q);
  const songsMiss = words.length > 0 && !parts.songs.some((t) => matchesAllWords(t, words));
  if (songsMiss && parts.videos === null) return { rows, tracks, artistsOnTop };
  const promoted = songsMiss ? (parts.videos ?? []).filter((t) => matchesAllWords(t, words)) : [];
  const ranked = [...promoted, ...rankByQuery(parts.songs, q)];
  const songsShown = add(ranked, SONG_CAP);

  if (parts.videos === null) return { rows, tracks, artistsOnTop };
  add(rankByQuery(parts.videos, q), Math.max(0, YOUTUBE_TOTAL - songsShown));
  return { rows, tracks, artistsOnTop };
}
