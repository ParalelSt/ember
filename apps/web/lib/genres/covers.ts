import type { Track } from '../../types/track';
import { tileCovers } from '../chartsView';

/** A generated list's hero cover from its songs: a 2x2 mosaic of the first
 *  four distinct covers, or the first cover alone when there are fewer. */
export function topCovers(tracks: readonly Pick<Track, 'artworkUrl'>[]): { src: string | null; mosaic?: string[] } {
  const urls = tileCovers(tracks, 4);
  return urls.length === 4 ? { src: null, mosaic: urls } : { src: urls[0] ?? null };
}
