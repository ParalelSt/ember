import type { Track } from '@/types/track';

interface TrackRow {
  id: string;
  source: string;
  source_id: string;
  title: string;
  artist: string;
  artist_id?: string | null;
  album: string | null;
  album_id?: string | null;
  duration_sec: number;
  artwork_url: string | null;
  stream_url: string;
}

/** Converts a Supabase `tracks` row (snake_case) into the camelCase Track shape. */
export function mapTrackRow(row: TrackRow | null | undefined): Track | null {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source as Track['source'],
    sourceId: row.source_id,
    title: row.title,
    artist: row.artist,
    artistId: row.artist_id ?? null,
    album: row.album,
    albumId: row.album_id ?? null,
    durationSec: row.duration_sec,
    artworkUrl: row.artwork_url,
    streamUrl: row.stream_url,
  };
}
