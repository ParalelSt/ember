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

/** Liked-songs rows for the "Collection page" section on /dizajn: the real
 *  CollectionPage renders them, so they are full Track records. One has no
 *  artwork, so the no-art row shows up next to the covered ones. */
export const MOCK_LIKED_TRACKS: Track[] = [
  makeTrack({ sourceId: 'l1', title: 'Slow Static', artist: 'Aftertone', album: 'Low Light', durationSec: 221, artworkUrl: MOCK_ART_1 }),
  makeTrack({ sourceId: 'l2', title: 'Harbor Lights', artist: 'Coastline', album: 'Tidewater', durationSec: 242, artworkUrl: MOCK_ART_2 }),
  makeTrack({ sourceId: 'l3', title: 'Second Nature', artist: 'Field Notes', album: 'Margins', durationSec: 198 }),
  makeTrack({ sourceId: 'l4', title: 'Northbound', artist: 'The Nulls', album: 'Night Service', durationSec: 263, artworkUrl: MOCK_ART_1 }),
];

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

export type ChartMovement = 'up' | 'down' | 'new' | 'same';

/** One chart position for the "Trending shelf" candidates: the rank is the
 *  position in MOCK_CHART (1-based), the movement is against yesterday. */
export interface MockChartEntry {
  track: Track;
  movement: ChartMovement;
  /** Places moved, for up and down. */
  change?: number;
}

// [title, artist, movement, places moved]. Real-looking global chart, top
// 50, the way YouTube Music's "Daily Top Music Videos - Global" reads.
const CHART_ROWS: [string, string, ChartMovement, number?][] = [
  ['Golden', 'HUNTR/X', 'same'],
  ['Dai Dai', 'Shakira', 'up', 3],
  ['The Fate of Ophelia', 'Taylor Swift', 'new'],
  ['Soda Pop', 'Saja Boys', 'down', 1],
  ['Manchild', 'Sabrina Carpenter', 'down', 2],
  ['APT.', 'ROSÉ & Bruno Mars', 'same'],
  ['Ordinary', 'Alex Warren', 'up', 2],
  ['Die With A Smile', 'Lady Gaga & Bruno Mars', 'down', 1],
  ['Your Idol', 'Saja Boys', 'up', 4],
  ['Jump', 'BLACKPINK', 'down', 3],
  ['Gnarly', 'KATSEYE', 'up', 1],
  ['Birds of a Feather', 'Billie Eilish', 'down', 2],
  ['Training Season', 'Dua Lipa', 'new'],
  ['back to friends', 'sombr', 'same'],
  ['Abracadabra', 'Lady Gaga', 'down', 4],
  ['What It Sounds Like', 'HUNTR/X', 'up', 5],
  ['Luther', 'Kendrick Lamar & SZA', 'same'],
  ['Messy', 'Lola Young', 'down', 1],
  ['DtMF', 'Bad Bunny', 'up', 2],
  ['Sapphire', 'Ed Sheeran', 'down', 6],
  ['Tears', 'Sabrina Carpenter', 'same'],
  ['Just Keep Watching', 'Tate McRae', 'up', 3],
  ['Pink Pony Club', 'Chappell Roan', 'down', 2],
  ['Undressed', 'sombr', 'same'],
  ['Takedown', 'HUNTR/X', 'up', 1],
  ['Daisies', 'Justin Bieber', 'down', 5],
  ['Anxiety', 'Doechii', 'same'],
  ['Baile Inolvidable', 'Bad Bunny', 'up', 4],
  ['Gabriela', 'KATSEYE', 'down', 1],
  ['Shake It To The Max (FLY)', 'Moliy', 'new'],
  ['Blue', 'yung kai', 'same'],
  ['Mutt', 'Leon Thomas', 'up', 2],
  ['Timeless', 'The Weeknd & Playboi Carti', 'down', 3],
  ['Lose Control', 'Teddy Swims', 'same'],
  ['Beautiful Things', 'Benson Boone', 'down', 2],
  ['Sailor Song', 'Gigi Perez', 'up', 1],
  ['Folded', 'Kehlani', 'up', 6],
  ['How It\'s Done', 'HUNTR/X', 'down', 4],
  ['Jai Jai Ram', 'Shreya Ghoshal', 'new'],
  ['NUEVAYoL', 'Bad Bunny', 'same'],
  ['Bad Dreams', 'Teddy Swims', 'down', 1],
  ['Free', 'Rumi & Jinu', 'up', 3],
  ['Espresso', 'Sabrina Carpenter', 'down', 2],
  ['I Had Some Help', 'Post Malone & Morgan Wallen', 'same'],
  ['Zoo', 'Shakira', 'up', 5],
  ['Shararat', 'Madhubanti Bagchi', 'down', 3],
  ['A Bar Song (Tipsy)', 'Shaboozey', 'same'],
  ['Stargazing', 'Myles Smith', 'up', 1],
  ['SaWaDiKa', 'LISA', 'new'],
  ['Good Luck, Babe!', 'Chappell Roan', 'down', 7],
];

// Chart covers: the same flat two-tone stand-ins as the Home shelves,
// cycled so neighbouring rows never share a cover.
const CHART_PALETTE: [string, string][] = [
  ['#4b3a2c', '#d59a5c'],
  ['#2f3d4c', '#6f8aa3'],
  ['#3d2c4b', '#8e6fb0'],
  ['#2c4638', '#78a38a'],
  ['#4b2c33', '#b56b78'],
  ['#27404a', '#5fa0b3'],
  ['#3a4a2c', '#98ae6a'],
];
const CHART_SHAPES = ['circle', 'square', 'bars'] as const;

/** Today's chart, number 1 first: 50 entries with artwork and a movement
 *  marker, for the "Trending shelf" section on /dizajn. */
export const MOCK_CHART: MockChartEntry[] = CHART_ROWS.map(([title, artist, movement, change], i) => {
  const [bg, fg] = CHART_PALETTE[i % CHART_PALETTE.length];
  return {
    track: makeTrack({
      sourceId: `chart${i + 1}`,
      title,
      artist,
      durationSec: 150 + ((i * 37) % 110),
      artworkUrl: mockCover(bg, fg, CHART_SHAPES[i % CHART_SHAPES.length]),
    }),
    movement,
    change,
  };
});
