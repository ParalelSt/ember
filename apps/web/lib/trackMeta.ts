import 'server-only';
import { findArtistId, getTrack } from '@/lib/sources/youtube';
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
      // Old rows can have an empty stream_url, always serve a usable one.
      if (!track.streamUrl) track.streamUrl = `/api/youtube/stream/${videoId}`;
      if (!track.artistId) track.artistId = await resolveArtistIdFor(videoId, track.artist);
      return track;
    }
  } catch {
    // Not in PB (or PB down), fall through to ytmusicapi.
  }
  return getTrack(videoId);
}

/** Longest the track route waits for the artist lookup before answering with
 *  the plain name (the lookup keeps running and fills the cache). */
const ARTIST_WAIT_MS = 3000;
const NONE_TTL_MS = 10 * 60_000;
const artistIdCache = new Map<string, { id: string | null; at: number }>();
const artistIdInflight = new Map<string, Promise<string | null>>();

export function clearArtistIdCache(): void {
  artistIdCache.clear();
  artistIdInflight.clear();
}

/** Artist channel for a stored track that has none, so the song page can
 *  always link to /artist/<id>. A real YT Music artist (exact name match)
 *  wins; otherwise the video's uploader channel from the track lookup.
 *  Answers are cached in memory (misses for ten minutes); a slow lookup
 *  returns null now and is there on the next request. */
export async function resolveArtistIdFor(videoId: string, artistName: string): Promise<string | null> {
  const hit = artistIdCache.get(videoId);
  if (hit && (hit.id || Date.now() - hit.at < NONE_TTL_MS)) return hit.id;
  let work = artistIdInflight.get(videoId);
  if (!work) {
    work = lookupArtistId(videoId, artistName)
      .then((id) => {
        artistIdCache.set(videoId, { id, at: Date.now() });
        return id;
      })
      .catch(() => null)
      .finally(() => artistIdInflight.delete(videoId));
    artistIdInflight.set(videoId, work);
  }
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ARTIST_WAIT_MS).unref?.()),
  ]);
}

async function lookupArtistId(videoId: string, artistName: string): Promise<string | null> {
  const name = artistName?.trim();
  const [uploader, artist] = await Promise.all([
    getTrack(videoId).then((t) => t?.artistId ?? null, () => null),
    name ? findArtistId(name).catch(() => null) : Promise.resolve(null),
  ]);
  return artist || uploader || null;
}
