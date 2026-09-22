import type { Track } from '@/types/track';
import { variantMarkers } from '@/lib/import/score';

/** A normalized identity for a song, ignoring version noise — so "Blinding
 *  Lights", "Blinding Lights (Official Video)", "Blinding Lights (Live)" and
 *  "Blinding Lights [Lyrics]" all collapse to the same key. Used to keep radio
 *  from queueing a different *version* of what's already playing/queued, and
 *  to make the "liked" heart show the same across variants of a song.
 *
 *  "Noise" and "version" are different things: (Official Video), [Lyrics],
 *  remaster, feat./ft. spelling, and punctuation don't change which recording
 *  it is, so they collapse. An instrumental, live take, remix, acoustic,
 *  karaoke, sped up/slowed, cover, demo, extended, radio edit, or
 *  clean/censored cut IS a different recording, so `variantMarkers` (the
 *  same marker list score.ts uses to penalize import matches) is folded into
 *  the key too — two titles with different markers never share an identity,
 *  even if their title text is otherwise identical after stripping noise. */
export function songKey(track: Pick<Track, 'title' | 'artist'> & { id?: string }): string {
  // Fall back to the raw lowercased title when aggressive normalization strips
  // it to nothing — titles that are entirely version-noise/punctuation, or in a
  // non-Latin script (which `[^a-z0-9]` would erase). Without this, every such
  // song by one artist collapses to the same `::artist` key, so liking one
  // makes the others' hearts light up too (findLikedVariant false-positive).
  const title = normalizeTitle(track.title ?? '') || rawTitle(track.title ?? '');
  const variant = variantMarkers(track.title ?? '');
  // The artist needs the same fallback, and for the same reason: a name in
  // Cyrillic, Japanese, Korean or Greek normalizes to nothing, which made
  // every song of that title share one key whoever recorded it.
  const artist = normalizeArtist(track.artist ?? '') || (track.artist ?? '').trim().toLowerCase();
  // No artist at all is not an identity: "Home" is a dozen unrelated songs.
  // Key on the track's own id instead, which only ever matches itself, so
  // liking one artist-less song can never light up another's heart. Callers
  // that look a song up by name alone (tabs, replacements) have no id; those
  // keep sharing a key, which is what they want.
  if (!artist && track.id) return `id:${track.id}`;
  return `${title}::${variant}::${artist}`;
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

/** The fallback for a title that normalizes to nothing (a non-Latin script,
 *  or pure punctuation): the raw title with the version noise in brackets
 *  still taken off, so "さよなら (Official Video)" and "さよなら" stay one song. */
function rawTitle(s: string): string {
  const stripped = s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // A title that is nothing BUT brackets keeps them, rather than becoming an
  // empty key that every such title would share.
  return stripped || s.trim().toLowerCase();
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
