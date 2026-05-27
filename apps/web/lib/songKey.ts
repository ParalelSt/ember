import type { Track } from '@/types/track';

/** A normalized identity for a song, ignoring version noise — so "Blinding
 *  Lights", "Blinding Lights (Official Video)", "Blinding Lights (Live)" and
 *  "Blinding Lights [Lyrics]" all collapse to the same key. Used to keep radio
 *  from queueing a different *version* of what's already playing/queued. */
export function songKey(track: Pick<Track, 'title' | 'artist'>): string {
  return `${normalizeTitle(track.title ?? '')}::${normalizeArtist(track.artist ?? '')}`;
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
