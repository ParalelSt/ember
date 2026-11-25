import 'server-only';
import { findArtistId, getTrack } from '@/lib/sources/youtube';
import { createAdminClient } from '@/lib/pocketbase/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { createTtlMemo } from '@/lib/ttlMemo';
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

/** The song page's embed lookup, remembered: a shared link is opened by a
 *  crowd (and by every crawler that unfurls it) within minutes, and each
 *  open used to redo the database read and, for a song nobody saved, a
 *  Python run. Ten minutes; a song that could not be found is asked again. */
const META_MEMO = createTtlMemo<Track | null>({ ttlMs: 10 * 60_000, max: 200, keep: (t) => t !== null });

export function fetchTrackMetaCached(videoId: string): Promise<Track | null> {
  if (!VIDEO_ID_RE.test(videoId)) return Promise.resolve(null);
  return META_MEMO.get(videoId, () => fetchTrackMeta(videoId));
}

export function clearTrackMetaCache(): void {
  META_MEMO.clear();
}

/** How long a person's own page load waits for the embed lookup. */
export const BROWSER_META_WAIT_MS = 600;

/** The lookup for a page a person is opening: their page does not need the
 *  embed card, so a slow lookup (it keeps running and fills the cache for
 *  the next open) gives way to the default metadata instead of holding the
 *  page back. Crawlers (`patient`) wait for the real answer, it is the
 *  whole point of their visit. */
export async function fetchTrackMetaForPage(videoId: string, { patient }: { patient: boolean }): Promise<Track | null> {
  const lookup = fetchTrackMetaCached(videoId);
  if (patient) return lookup;
  lookup.catch(() => {});
  return Promise.race([
    lookup,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BROWSER_META_WAIT_MS).unref?.()),
  ]);
}

/** Link-preview fetchers (Discord, Messenger, iMessage, Slack, search
 *  engines): the visitors that need the full metadata. */
export function isPreviewCrawler(userAgent: string | null | undefined): boolean {
  return /bot|crawler|spider|facebookexternalhit|facebot|slurp|whatsapp|telegram|skype|preview|embed|iframely|applebot|imessage|linkedin|pinterest|vkshare|google-inspectiontool/i.test(userAgent ?? '');
}

/** Longest the track route waits for the artist lookup before answering with
 *  the plain name (the lookup keeps running and fills the cache). */
const ARTIST_WAIT_MS = 3000;
const NONE_TTL_MS = 10 * 60_000;
/** Most songs whose artist is remembered: least recently asked go first.
 *  One entry per song ever looked up lived as long as the server did. */
export const ARTIST_ID_CACHE_MAX = 500;
const artistIdCache = new Map<string, { id: string | null; at: number }>();
const artistIdInflight = new Map<string, Promise<string | null>>();

function rememberArtistId(videoId: string, entry: { id: string | null; at: number }): void {
  artistIdCache.delete(videoId);
  artistIdCache.set(videoId, entry);
  while (artistIdCache.size > ARTIST_ID_CACHE_MAX) {
    const oldest = artistIdCache.keys().next().value;
    if (oldest === undefined) break;
    artistIdCache.delete(oldest);
  }
}

export function clearArtistIdCache(): void {
  artistIdCache.clear();
  artistIdInflight.clear();
}

/** Test seam. */
export function artistIdCacheSize(): number {
  return artistIdCache.size;
}

/** Artist channel for a stored track that has none, so the song page can
 *  always link to /artist/<id>. A real YT Music artist (exact name match)
 *  wins; otherwise the video's uploader channel from the track lookup.
 *  Answers are cached in memory (misses for ten minutes); a slow lookup
 *  returns null now and is there on the next request. */
export async function resolveArtistIdFor(videoId: string, artistName: string): Promise<string | null> {
  const hit = artistIdCache.get(videoId);
  if (hit && (hit.id || Date.now() - hit.at < NONE_TTL_MS)) {
    // Asked again: the most recent now.
    rememberArtistId(videoId, hit);
    return hit.id;
  }
  let work = artistIdInflight.get(videoId);
  if (!work) {
    work = lookupArtistId(videoId, artistName)
      .then((id) => {
        rememberArtistId(videoId, { id, at: Date.now() });
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
