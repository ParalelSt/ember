import 'server-only';
import { getTrack } from '@/lib/sources/youtube';
import { createAdminClient } from '@/lib/pocketbase/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import type { Track } from '@/types/track';

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Two-tier track lookup shared by the /api/youtube/track route and the
 *  /track/[id] page's generateMetadata (Discord/Messenger embeds):
 *  PocketBase first (proper music metadata for anything a member has played /
 *  liked / playlisted), ytmusicapi get_song as the fallback. */
export async function fetchTrackMeta(videoId: string): Promise<Track | null> {
  if (!VIDEO_ID_RE.test(videoId)) return null;

  try {
    // createAdminClient stays INSIDE the try: if PB is unreachable it throws,
    // and the ytmusicapi fallback below must still get its chance.
    const pb = await createAdminClient();
    const row = await pb
      .collection('tracks')
      .getFirstListItem(`external_id = "youtube:${videoId}"`);
    const track = mapTrackRow(row as unknown as TrackRecord);
    if (track) {
      // Old rows can have an empty stream_url — always serve a usable one.
      if (!track.streamUrl) track.streamUrl = `/api/youtube/stream/${videoId}`;
      return track;
    }
  } catch {
    // Not in PB (or PB down) — fall through to ytmusicapi.
  }
  return getTrack(videoId);
}
