/**
 * Canonical Track shape used end-to-end (API, route handlers, store, UI).
 * Compound id is `{source}:{sourceId}` so the DB pool can dedupe across sources.
 */
export interface Track {
  id: string;
  source: 'jamendo' | 'youtube';
  sourceId: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  albumId: string | null;
  durationSec: number;
  artworkUrl: string | null;
  streamUrl: string;
}

export interface Playlist {
  id: string;
  name: string;
  created_at: string;
  artwork_url: string | null;
}

export interface AlbumSummary {
  browseId: string;
  title: string;
  year: number | string | null;
  thumbnails: { url: string; width?: number; height?: number }[];
}

export interface ArtistPayload {
  name: string;
  description: string | null;
  thumbnails: { url: string; width?: number; height?: number }[];
  tracks: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
}

export interface AlbumDetail {
  title: string;
  artist: string;
  artistId: string | null;
  year: number | null;
  thumbnails: { url: string; width?: number; height?: number }[];
  trackCount: number;
  totalDurationSec: number;
  tracks: Track[];
}

/** Where a queue was started from. Drives radio-mode behavior — e.g. when the
 *  artist's catalog finishes, we filter out more-of-the-same so the listener
 *  drifts into similar-genre tracks by other artists. */
export type PlaybackContext =
  | { type: 'artist'; artistName: string; artistId?: string | null }
  | { type: 'search'; query?: string }
  | { type: 'playlist'; playlistId: string; playlistName: string }
  | { type: 'album'; albumId: string; albumTitle: string }
  | { type: 'liked' }
  | { type: 'history' }
  | { type: 'radio' }
  | { type: 'single' };
