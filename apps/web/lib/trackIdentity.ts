import type { Track } from '@/types/track';
import { songKey } from '@/lib/songKey';

/** Which song a track is, robust to how its id was spelled.
 *
 *  Track ids are `{source}:{sourceId}` ("youtube:X59TlszGtfM"), but a
 *  doubled prefix ("youtube:youtube:X59TlszGtfM") turns up in reports and
 *  older rows, and a PocketBase row carries the same song as
 *  source + source_id. Every spelling folds onto `source:sourceId`, and the
 *  song itself (songKey: another upload of the same recording) is a key of
 *  its own, so "already in the playlist" holds across both. */

type Identifiable = Pick<Track, 'id' | 'title' | 'artist'> & Partial<Pick<Track, 'source' | 'sourceId'>>;

/** "youtube:youtube:X" and "youtube:X" are one id. */
export function canonicalId(id: string): string {
  const parts = id.split(':');
  while (parts.length > 2 && parts[0] === parts[1]) parts.shift();
  return parts.join(':');
}

/** Every key a track answers to: its id (canonical), its source id, and
 *  its song. */
export function identityKeys(t: Identifiable): string[] {
  const keys = new Set<string>();
  if (t.id) keys.add(`id:${canonicalId(t.id)}`);
  if (t.source && t.sourceId) keys.add(`id:${canonicalId(`${t.source}:${t.sourceId}`)}`);
  keys.add(`song:${songKey(t)}`);
  return [...keys];
}

/** Most keys an exclusion list carries: it rides in the persisted playback
 *  context, so a huge playlist must not bloat local storage. */
export const MAX_EXCLUDE_KEYS = 3000;

/** The keys of every track in `tracks`, for "not one of these" checks.
 *  `limit` caps a list that will be stored (MAX_EXCLUDE_KEYS). */
export function exclusionKeys(tracks: readonly Identifiable[], limit = Infinity): string[] {
  const out = new Set<string>();
  for (const t of tracks) {
    for (const k of identityKeys(t)) {
      if (out.size >= limit) return [...out];
      out.add(k);
    }
  }
  return [...out];
}

/** True when `t` matches any key in `keys` (built with exclusionKeys). */
export function isExcluded(t: Identifiable, keys: ReadonlySet<string>): boolean {
  if (keys.size === 0) return false;
  return identityKeys(t).some((k) => keys.has(k));
}
