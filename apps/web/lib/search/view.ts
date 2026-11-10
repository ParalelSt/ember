import type { Track } from '@/types/track';
import { isDirectArtistSearch, rankByQuery } from './rank';
import type { SearchArtist, SearchParts } from './types';

/** Up to this many artists in the Artists section. */
export const MAX_ARTISTS = 3;
/** Not a direct artist search: the Artists section goes under this many
 *  top songs. */
export const ARTISTS_AFTER_SONGS = 3;
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
 *  re-ranked so results with every word of the query come first. */
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

  add(own);
  if (parts.uploads === null) return { rows, tracks, artistsOnTop: false };
  add(parts.uploads);

  const artists = (parts.artists ?? []).slice(0, MAX_ARTISTS);
  const artistsRow: SearchRow | null = artists.length
    ? { kind: 'artists', key: 'artists', artists }
    : null;
  const artistsOnTop = !!artistsRow && isDirectArtistSearch(q, artists[0].name);
  if (artistsOnTop && artistsRow) rows.push(artistsRow);

  if (parts.songs === null) return { rows, tracks, artistsOnTop };
  const ranked = rankByQuery(parts.songs, q);
  const songsShown = add(ranked.slice(0, ARTISTS_AFTER_SONGS));
  if (!artistsOnTop && artistsRow) rows.push(artistsRow);
  const rest = add(ranked.slice(ARTISTS_AFTER_SONGS), Math.max(0, SONG_CAP - songsShown));

  if (parts.videos === null) return { rows, tracks, artistsOnTop };
  add(rankByQuery(parts.videos, q), Math.max(0, YOUTUBE_TOTAL - songsShown - rest));
  return { rows, tracks, artistsOnTop };
}
