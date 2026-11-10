import type { Track } from '@/types/track';

/** An artist the search found: opens /artist/[id]. */
export interface SearchArtist {
  /** YouTube Music channel id (the artist page's id). */
  id: string;
  name: string;
  artworkUrl: string | null;
}

/** One line of the streamed search (`GET /api/search?q=...&stream=1`, one
 *  JSON object per line). The server sends them in display order: uploads,
 *  then artists and songs together, then videos, then `done`.
 *
 *  `legacy` never comes over the wire: it is how the client reads an older
 *  server's one-shot `{ tracks }` answer (and the empty-query Trending
 *  list), so both still show. */
export type SearchChunk =
  | { type: 'uploads'; tracks: Track[] }
  | { type: 'artists'; artists: SearchArtist[] }
  | { type: 'songs'; tracks: Track[] }
  | { type: 'videos'; tracks: Track[] }
  | { type: 'legacy'; tracks: Track[] }
  | { type: 'error'; status: number; error: string }
  | { type: 'done' };

/** What the search has received so far for one query: the streamed
 *  chunks folded together. A group is null until it has arrived. */
export interface SearchParts {
  uploads: Track[] | null;
  artists: SearchArtist[] | null;
  songs: Track[] | null;
  videos: Track[] | null;
  /** The last error chunk, if YouTube could not be searched. */
  error: { status: number; error: string } | null;
  done: boolean;
}

export const EMPTY_SEARCH_PARTS: SearchParts = {
  uploads: null,
  artists: null,
  songs: null,
  videos: null,
  error: null,
  done: false,
};

/** Folds one chunk into what has arrived so far (the streamed query's
 *  reducer). Pure: returns a new object. */
export function addSearchChunk(parts: SearchParts, chunk: SearchChunk): SearchParts {
  switch (chunk.type) {
    case 'uploads':
      return { ...parts, uploads: chunk.tracks };
    case 'artists':
      return { ...parts, artists: chunk.artists };
    case 'songs':
      return { ...parts, songs: chunk.tracks };
    case 'videos':
      return { ...parts, videos: chunk.tracks };
    case 'legacy':
      // One finished list: every group is in.
      return { uploads: [], artists: [], songs: chunk.tracks, videos: [], error: null, done: true };
    case 'error':
      return { ...parts, error: { status: chunk.status, error: chunk.error } };
    case 'done':
      return { ...parts, done: true };
    default:
      return parts;
  }
}
