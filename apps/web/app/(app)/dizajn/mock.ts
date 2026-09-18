import type { CollectionCardProps } from '@/components/library/CollectionCard';
import type { Track } from '@/types/track';

// Two tiny inline photos so "has artwork" mock cards show something other
// than the gradient fallback, without a network request. Flat colour
// blocks, not part of the app's own palette: they stand in for a member's
// uploaded cover art, not a design-system choice.
const MOCK_ART_1 =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3b4a5a"/><circle cx="100" cy="100" r="55" fill="#5d7a92"/></svg>',
  );
const MOCK_ART_2 =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#4a3b52"/><rect x="40" y="40" width="120" height="120" fill="#7a5d92"/></svg>',
  );

/** Six playlists covering every case the brief asks the options to be
 *  comparable on: with art, without art (gradient fallback), a long name, a
 *  short name, and one downloaded. Shared by every option in section 2 and
 *  by the tests, so "does it render the no-art one" means the same card in
 *  every treatment. */
export const MOCK_PLAYLISTS: CollectionCardProps[] = [
  {
    title: 'Late Night Drive',
    subtitle: '42 tracks',
    href: '/playlist/mock-1',
    cover: { src: MOCK_ART_1, icon: null },
    size: 'md',
  },
  {
    title: 'Songs to Cook Extremely Elaborate Pasta Dinners To',
    subtitle: '18 tracks',
    href: '/playlist/mock-2',
    cover: { src: null, icon: null },
    size: 'md',
  },
  {
    title: 'Gym',
    subtitle: 'Downloaded',
    href: '/playlist/mock-3',
    cover: { src: MOCK_ART_2, icon: null },
    badge: 'downloaded',
    size: 'md',
  },
  {
    title: 'Sunday Mornings',
    subtitle: 'Aron Matoic',
    href: '/playlist/mock-4',
    cover: { src: null, icon: null },
    size: 'md',
  },
  {
    title: '90s Alt Rock Deep Cuts',
    subtitle: '63 tracks',
    href: '/playlist/mock-5',
    cover: { src: MOCK_ART_1, icon: null },
    size: 'md',
  },
  {
    title: 'For Dad',
    subtitle: '12 tracks',
    href: '/playlist/mock-6',
    cover: { src: null, icon: null },
    size: 'md',
  },
];

function makeTrack(over: Partial<Track>): Track {
  return {
    id: `mock:${over.sourceId ?? '0'}`,
    source: 'youtube',
    sourceId: '0',
    title: 'Untitled',
    artist: 'Unknown',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

/** Recent-searches rows for the overlay's empty state. */
export const MOCK_RECENT_TRACKS: Track[] = [
  makeTrack({ sourceId: 'r1', title: 'Midnight Drive', artist: 'The Nulls' }),
  makeTrack({ sourceId: 'r2', title: 'Harbor Lights', artist: 'Coastline' }),
];

/** Results rows for the overlay's "results" state. */
export const MOCK_RESULT_TRACKS: Track[] = [
  makeTrack({ sourceId: 'q1', title: 'Second Wind', artist: 'Aftertone' }),
  makeTrack({ sourceId: 'q2', title: 'Second Nature', artist: 'Field Notes' }),
  makeTrack({ sourceId: 'q3', title: 'Seconds Apart', artist: 'The Nulls' }),
];
