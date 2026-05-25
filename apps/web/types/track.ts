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
}

export interface ArtistPayload {
  name: string;
  description: string | null;
  thumbnails: { url: string; width?: number; height?: number }[];
  tracks: Track[];
  albums: unknown[];
}
