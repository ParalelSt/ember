import type { Track } from '../../types/track';

/** A generated list's hero cover from its songs: a 2x2 mosaic of the first
 *  four distinct covers, or the first cover alone when there are fewer. */
export function topCovers(tracks: readonly Pick<Track, 'artworkUrl'>[]): { src: string | null; mosaic?: string[] } {
  const urls: string[] = [];
  for (const t of tracks) {
    if (t.artworkUrl && !urls.includes(t.artworkUrl)) urls.push(t.artworkUrl);
    if (urls.length === 4) break;
  }
  return urls.length === 4 ? { src: null, mosaic: urls } : { src: urls[0] ?? null };
}
