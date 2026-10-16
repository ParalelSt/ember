import type { Track } from '@/types/track';

/** Test helper: a YouTube track with an 11-character id made from `id`. */
export function tt(id: string, artist: string, title = `${artist} ${id}`): Track {
  const vid = id.replace(/[^A-Za-z0-9_-]/g, '').padEnd(11, '0').slice(0, 11);
  return {
    id: `youtube:${vid}`, source: 'youtube', sourceId: vid, title, artist, artistId: null,
    album: null, albumId: null, durationSec: 200, artworkUrl: `https://img/${vid}`, streamUrl: `/api/youtube/stream/${vid}`,
  };
}
