import type { Track } from '@/types/track';

/** Shape of a PocketBase `tracks` record (the fields we persist). */
export interface TrackRecord {
  id: string;             // PocketBase internal record id (used in relations)
  external_id: string;    // App-facing id, e.g. "yt_dQw4w9WgXcQ"
  source: string;
  source_id: string;
  title: string;
  artist?: string;
  artist_id?: string;
  album?: string;
  album_id?: string;
  duration_sec?: number;
  artwork_url?: string;
  stream_url?: string;
}

/** Converts a PocketBase `tracks` record into the camelCase Track shape used
 *  throughout the app. `Track.id` mirrors the old SQL primary key (the
 *  app-facing external id), not the PocketBase record id. */
export function mapTrackRow(row: TrackRecord | null | undefined): Track | null {
  if (!row) return null;
  return {
    id: row.external_id,
    source: row.source as Track['source'],
    sourceId: row.source_id,
    title: row.title,
    artist: row.artist ?? '',
    artistId: row.artist_id || null,
    album: row.album ?? null,
    albumId: row.album_id || null,
    durationSec: row.duration_sec ?? 0,
    artworkUrl: row.artwork_url ?? null,
    streamUrl: row.stream_url ?? '',
  };
}
