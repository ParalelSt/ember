import type { Track } from '@/types/track';

/** Stand-in tracks for the Appearance preview: real Track records so the
 *  real TrackList renders them, with flat two-tone covers (artwork, not
 *  palette choices, so they stay the same in every theme). */

function cover(bg: string, fg: string, shape: 'circle' | 'square' | 'bars'): string {
  const body =
    shape === 'circle'
      ? `<circle cx="100" cy="100" r="58" fill="${fg}"/>`
      : shape === 'square'
        ? `<rect x="46" y="46" width="108" height="108" fill="${fg}"/>`
        : `<rect x="30" y="60" width="140" height="18" fill="${fg}"/><rect x="30" y="92" width="100" height="18" fill="${fg}"/><rect x="30" y="124" width="120" height="18" fill="${fg}"/>`;
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${bg}"/>${body}</svg>`,
    )
  );
}

function track(sourceId: string, title: string, artist: string, artworkUrl: string): Track {
  return {
    id: `preview:${sourceId}`,
    source: 'youtube',
    sourceId,
    title,
    artist,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 214,
    artworkUrl,
    streamUrl: '',
  };
}

export const PREVIEW_TRACKS: Track[] = [
  track('p1', 'Low Tide', 'Aftertone', cover('#2f3d4c', '#6f8aa3', 'circle')),
  track('p2', 'Copper Sky', 'Coastline', cover('#4b3a2c', '#b98a5c', 'square')),
  track('p3', 'Field Day', 'Field Notes', cover('#2c4638', '#78a38a', 'bars')),
];

/** The track "playing" in the preview's player bar. */
export const PREVIEW_NOW_PLAYING: Track = PREVIEW_TRACKS[1];
