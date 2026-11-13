import type { Track } from '@/types/track';

/** The song's own page (/track/<videoId>), or null for a song that has
 *  none: only YouTube songs do (an upload or a radio station has no
 *  shareable page). The same rule the Share button uses. */
export function songPageHref(track: Pick<Track, 'source' | 'sourceId'> | null | undefined): string | null {
  if (!track || track.source !== 'youtube' || !track.sourceId) return null;
  return `/track/${encodeURIComponent(track.sourceId)}`;
}

/** The artist's page, or null when the artist id is not known. */
export function artistPageHref(track: Pick<Track, 'artistId'> | null | undefined): string | null {
  return track?.artistId ? `/artist/${encodeURIComponent(track.artistId)}` : null;
}
