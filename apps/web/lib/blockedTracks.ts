import type PocketBase from 'pocketbase';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { exclusionKeys, isExcluded } from '@/lib/trackIdentity';
import type { Track } from '@/types/track';

/** Most songs one person can block; the oldest go first past it. */
export const MAX_BLOCKED = 1000;

/** `tracks` without the blocked songs: the song itself in any id spelling,
 *  and other uploads of it (lib/trackIdentity), so a blocked song does not
 *  come back as its lyric video. Pure. */
export function withoutBlocked<T extends Track>(tracks: T[], blocked: readonly Track[]): T[] {
  if (!blocked.length) return tracks;
  const keys = new Set(exclusionKeys(blocked));
  return tracks.filter((t) => !isExcluded(t, keys));
}

/** One user's blocked songs, newest first. A client that cannot read them
 *  (no collection yet, PocketBase down) gets none: recommendations still
 *  work, they just are not filtered. */
export async function listBlocked(pb: PocketBase, userId: string): Promise<Track[]> {
  try {
    const rows = await pb.collection('blocked_tracks').getFullList({
      filter: pb.filter('user = {:user}', { user: userId }),
      sort: '-blocked_at',
      expand: 'track',
    });
    return rows
      .map((r) => mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null))
      .filter((t): t is Track => !!t);
  } catch {
    return [];
  }
}
