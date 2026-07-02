import type { Track } from '@/types/track';

/** A normalized identity for a song, ignoring version noise — so "Blinding
 *  Lights", "Blinding Lights (Official Video)", "Blinding Lights (Live)" and
 *  "Blinding Lights [Lyrics]" all collapse to the same key. Used to keep radio
 *  from queueing a different *version* of what's already playing/queued, and
 *  to make the "liked" heart show the same across variants of a song. */
export function songKey(track: Pick<Track, 'title' | 'artist'>): string {
  // Fall back to the raw lowercased title when aggressive normalization strips
  // it to nothing — titles that are entirely version-noise/punctuation, or in a
  // non-Latin script (which `[^a-z0-9]` would erase). Without this, every such
  // song by one artist collapses to the same `::artist` key, so liking one
  // makes the others' hearts light up too (findLikedVariant false-positive).
  const title = normalizeTitle(track.title ?? '') || (track.title ?? '').trim().toLowerCase();
  return `${title}::${normalizeArtist(track.artist ?? '')}`;
}

/** Returns the liked-list entry that matches `track` (same id or same
 *  normalized songKey), or null. Use to drive the heart UI and target the
 *  right row when toggling — clicking unlike on a variant operates on the
 *  existing liked entry rather than adding a second one. */
export function findLikedVariant(track: Track | null | undefined, liked: Track[]): Track | null {
  if (!track) return null;
  const direct = liked.find((t) => t.id === track.id);
  if (direct) return direct;
  const key = songKey(track);
  return liked.find((t) => songKey(t) === key) ?? null;
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')              // (official video), (live), (remix)…
    .replace(/\[[^\]]*\]/g, ' ')             // [lyrics], [official]…
    .replace(/\b(feat|ft|featuring|with)\b.*$/i, ' ') // feat. X …
    .replace(/\b(official|video|audio|lyrics?|hd|hq|mv|visualizer|remaster(ed)?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')             // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArtist(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*-\s*topic\s*$/i, '')        // YouTube auto "Artist - Topic"
    .replace(/\bvevo\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
