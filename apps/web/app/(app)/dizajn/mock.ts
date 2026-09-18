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

/** A Liked-songs collection hero, mock only: the header text and the first
 *  three rows, for the "Collection page rhythm" section on /dizajn
 *  (docs/design-system.md section 3). Same shape a real collection page
 *  would pass to CollectionHeader/TrackList, restated as plain data so
 *  RhythmPreview stays presentational (no Track/PlaybackContext wiring). */
export const MOCK_COLLECTION_HERO = {
  eyebrow: 'Playlist',
  title: 'Liked songs',
  meta: '10 songs · 38 min',
  tracks: [
    { id: 'h1', title: 'Slow Static', artist: 'Aftertone', duration: '3:41' },
    { id: 'h2', title: 'Harbor Lights', artist: 'Coastline', duration: '4:02' },
    { id: 'h3', title: 'Second Nature', artist: 'Field Notes', duration: '3:18' },
  ],
};

// Flat two-tone covers for the Home shelves in the changelog shell
// preview. Same idea as MOCK_ART_1/2 above: stand-ins for real artwork,
// not palette choices.
function mockCover(bg: string, fg: string, shape: 'circle' | 'square' | 'bars'): string {
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

/** Home-page shelf tracks for the "What's new" shell preview: enough for
 *  one full desktop row (six cards at lg), each with artwork so the shelf reads
 *  like a real Home page rather than a row of black boxes. */
export const MOCK_HOME_TRACKS: Track[] = [
  makeTrack({ sourceId: 'h1', title: 'Low Tide', artist: 'Aftertone', artworkUrl: mockCover('#2f3d4c', '#6f8aa3', 'circle') }),
  makeTrack({ sourceId: 'h2', title: 'Copper Sky', artist: 'Coastline', artworkUrl: mockCover('#4b3a2c', '#b98a5c', 'square') }),
  makeTrack({ sourceId: 'h3', title: 'Field Day', artist: 'Field Notes', artworkUrl: mockCover('#2c4638', '#78a38a', 'bars') }),
  makeTrack({ sourceId: 'h4', title: 'Night Swim', artist: 'The Nulls', artworkUrl: mockCover('#3d2c4b', '#8e6fb0', 'circle') }),
  makeTrack({ sourceId: 'h5', title: 'Paper Planes', artist: 'Lowlight', artworkUrl: mockCover('#4b2c33', '#b56b78', 'square') }),
  makeTrack({ sourceId: 'h7', title: 'Glass Coast', artist: 'Aftertone', artworkUrl: mockCover('#3a4a2c', '#98ae6a', 'circle') }),
];

/** Second Home shelf ("Recently played"), a different order and one new
 *  title so the two shelves don't look copy-pasted. */
export const MOCK_HOME_RECENT: Track[] = [
  makeTrack({ sourceId: 'h6', title: 'Northbound', artist: 'Coastline', artworkUrl: mockCover('#27404a', '#5fa0b3', 'bars') }),
  MOCK_HOME_TRACKS[3],
  MOCK_HOME_TRACKS[0],
  MOCK_HOME_TRACKS[4],
  MOCK_HOME_TRACKS[2],
  MOCK_HOME_TRACKS[5],
];

/** The track "playing" in the mock player bar. */
export const MOCK_NOW_PLAYING: Track = MOCK_HOME_TRACKS[1];

export interface ChangelogEntry {
  id: string;
  /** Short date label for the eyebrow, e.g. "Sep 16". */
  date: string;
  title: string;
  /** One line, used by the Home banner and the popover. */
  summary: string;
  /** Two or three short lines for the full page's card. */
  bullets: string[];
  /** Unread in the "Unread" preview state. */
  unread: boolean;
}

/** Five entries drawn from things that actually shipped recently, newest
 *  first. The first two are unread in the preview's Unread state, so the
 *  page shows both a New entry and an already-read one. */
export const MOCK_CHANGELOG: ChangelogEntry[] = [
  {
    id: 'instant-search',
    date: 'Sep 16',
    title: 'Instant search',
    summary: 'Search opens instantly, even on a slow connection.',
    bullets: [
      'Search opens the moment you tap it, before anything loads.',
      'Your recent searches show while results are on their way.',
      'Works offline too: it tells you it will run once you are back online.',
    ],
    unread: true,
  },
  {
    id: 'crash-reports',
    date: 'Sep 14',
    title: 'Automatic crash reports',
    summary: 'When something breaks, Ember can report it for you.',
    bullets: [
      'A crash sends its diagnostics straight to the project, no form to fill in.',
      'Turn it off any time in Settings > Help.',
    ],
    unread: true,
  },
  {
    id: 'requests',
    date: 'Sep 12',
    title: 'Send a request',
    summary: 'Ask for a feature or a fix from Settings > Help.',
    bullets: [
      'Suggest a new feature or report something that needs fixing.',
      'Requests go straight to the project, same as bug reports.',
    ],
    unread: false,
  },
  {
    id: 'seek-fix',
    date: 'Sep 10',
    title: 'Seeking no longer skips songs',
    summary: 'Dragging the seek bar in the desktop app stays on the same song.',
    bullets: [
      'Scrubbing near the end of a track no longer jumps to the next one.',
      'Desktop app only; the web player already behaved.',
    ],
    unread: false,
  },
  {
    id: 'skeletons',
    date: 'Sep 8',
    title: 'Loading skeletons',
    summary: 'Pages show their shape while they load instead of a blank screen.',
    bullets: [
      'Playlists, albums and artists sketch themselves in while data arrives.',
      'Less jumping around once everything has loaded.',
    ],
    unread: false,
  },
];
