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

/** The track "playing" in the Mobile player candidates. A long real name on
 *  purpose: it is the one the owner photographed being cut to "Yes ..." in
 *  today's bar, so every candidate is judged on the case that broke. */
export const MOCK_MOBILE_NOW_PLAYING: Track = makeTrack({
  sourceId: 'm1',
  title: 'Yes Sir, I Can Boogie',
  artist: 'Baccara',
  album: 'Baccara',
  durationSec: 264,
  artworkUrl: mockCover('#4b2c3f', '#c07a9e', 'circle'),
});

// ---------- Search overlay rows (the "Search rows" section) ----------

/** Recent-searches rows for the "Search rows" candidates. Separate from
 *  MOCK_RECENT_TRACKS (the "Instant search overlay" section further down
 *  the page) so every title on /dizajn stays unique and a test can look one
 *  up without hitting two sections at once. Each has artwork, because the
 *  "On the art" control has nowhere to sit without it. */
export const MOCK_SEARCH_RECENTS: Track[] = [
  makeTrack({ sourceId: 's1', title: 'Lantern Street', artist: 'Vellum', album: 'Paper Weather', durationSec: 194, artworkUrl: mockCover('#3a2f4b', '#8a76ad', 'circle') }),
  makeTrack({ sourceId: 's2', title: 'Salt Flats', artist: 'Bramblewood', album: 'Dry Season', durationSec: 226, artworkUrl: mockCover('#2f4038', '#6f9b82', 'bars') }),
  makeTrack({ sourceId: 's3', title: 'Quiet Hour', artist: 'Ivy Corner', album: 'Small Rooms', durationSec: 171, artworkUrl: mockCover('#45362b', '#b08a5f', 'square') }),
];

/** Result rows for the "Search rows" candidates: five, enough that the
 *  playing row has rows above and below it to be told apart from. */
export const MOCK_SEARCH_RESULTS: Track[] = [
  makeTrack({ sourceId: 's4', title: 'Winter Fair', artist: 'Vellum', album: 'Paper Weather', durationSec: 208, artworkUrl: mockCover('#2b3a4a', '#6b93ab', 'square') }),
  makeTrack({ sourceId: 's5', title: 'Marble Arch', artist: 'Bramblewood', album: 'Dry Season', durationSec: 245, artworkUrl: mockCover('#4a2b33', '#ad6a78', 'circle') }),
  makeTrack({ sourceId: 's6', title: 'Static Bloom', artist: 'Ivy Corner', album: 'Small Rooms', durationSec: 183, artworkUrl: mockCover('#2c4638', '#7fae93', 'bars') }),
  makeTrack({ sourceId: 's7', title: 'Long Division', artist: 'Hollow Pines', album: 'Arithmetic', durationSec: 262, artworkUrl: mockCover('#3f3a26', '#a39a5f', 'square') }),
  makeTrack({ sourceId: 's8', title: 'Perennial', artist: 'Vellum', album: 'Paper Weather', durationSec: 199, artworkUrl: mockCover('#2f3646', '#7280a8', 'circle') }),
];

/** The result row the "Search rows" preview starts on when a state other
 *  than "Nothing playing" is picked. */
export const MOCK_SEARCH_PLAYING_ID = MOCK_SEARCH_RESULTS[1].id;

// ---------- Phone search (the "Phone search" section) ----------

/** The query typed in the Phone search candidates' "Typing" and "Playing
 *  from search" states. */
export const MOCK_PHONE_SEARCH_QUERY = 'harbour';

/** Recent searches in the Phone search candidates. Their own titles, so
 *  every title on /dizajn stays unique and a test can find one without
 *  hitting another section. */
export const MOCK_PHONE_SEARCH_RECENTS: Track[] = [
  makeTrack({ sourceId: 'ps1', title: 'Copper Kettle', artist: 'Saltmarsh', album: 'Low Tide', durationSec: 201, artworkUrl: mockCover('#3d2f2a', '#b3805f', 'circle') }),
  makeTrack({ sourceId: 'ps2', title: 'Neon Orchard', artist: 'The Lindens', album: 'Glasshouse', durationSec: 233, artworkUrl: mockCover('#26383f', '#5f9fb3', 'bars') }),
  makeTrack({ sourceId: 'ps3', title: 'Paper Lanterns', artist: 'Mira Holt', album: 'Kites', durationSec: 188, artworkUrl: mockCover('#3b2a44', '#9a73b8', 'square') }),
];

/** Results for MOCK_PHONE_SEARCH_QUERY: six, so the list runs under the
 *  keyboard and the player the way a real result list does. */
export const MOCK_PHONE_SEARCH_RESULTS: Track[] = [
  makeTrack({ sourceId: 'ps4', title: 'Harbour Lights', artist: 'Saltmarsh', album: 'Low Tide', durationSec: 214, artworkUrl: mockCover('#1f3340', '#6aa0c0', 'circle') }),
  makeTrack({ sourceId: 'ps5', title: 'Harbour Road', artist: 'Glen Avery', album: 'Coastlines', durationSec: 247, artworkUrl: mockCover('#40301f', '#c09a6a', 'square') }),
  makeTrack({ sourceId: 'ps6', title: 'Grey Harbour', artist: 'The Lindens', album: 'Glasshouse', durationSec: 196, artworkUrl: mockCover('#2a3b2d', '#7fb38a', 'bars') }),
  makeTrack({ sourceId: 'ps7', title: 'Harbour Master', artist: 'Ottoline', album: 'Tidewater', durationSec: 268, artworkUrl: mockCover('#3f2433', '#b86a90', 'circle') }),
  makeTrack({ sourceId: 'ps8', title: 'Safe Harbour', artist: 'Mira Holt', album: 'Kites', durationSec: 205, artworkUrl: mockCover('#33343f', '#8a8cb8', 'square') }),
  makeTrack({ sourceId: 'ps9', title: 'Harbour Wall', artist: 'Saltmarsh', album: 'Low Tide', durationSec: 222, artworkUrl: mockCover('#3a3a24', '#aaa65f', 'bars') }),
];

/** The result started in the "Playing from search" state. */
export const MOCK_PHONE_SEARCH_PLAYING = MOCK_PHONE_SEARCH_RESULTS[1];

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

// ---------- Playlist import (the "Playlist import" section) ----------

/** One YouTube result the matcher weighed for a source track. `reasons`
 *  are the plain-words explanations the review screens show next to it;
 *  `good` colours them (a point for, or a point against). */
export interface ImportCandidate {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  kind: 'Official audio' | 'Music video' | 'Live' | 'Lyric video' | 'Fan upload';
  score: number;
  reasons: { text: string; good: boolean }[];
  artworkUrl: string;
}

export type ImportItemStatus = 'matched' | 'review' | 'not-found';

/** One row of the source playlist and what the import made of it. */
export interface ImportItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  status: ImportItemStatus;
  /** Review items: why the matcher was not sure, in one short line. */
  flag?: string;
  /** Review items: 3 to 5, best first (the default pick). */
  candidates?: ImportCandidate[];
}

const IMPORT_ART = [
  mockCover('#1f2a44', '#e0795a', 'circle'),
  mockCover('#2b1f3d', '#c46a9a', 'square'),
  mockCover('#13303a', '#4fb3c4', 'bars'),
  mockCover('#3a2418', '#e3a15c', 'circle'),
  mockCover('#1d2b22', '#7fbf8f', 'square'),
  mockCover('#2a2a3a', '#9aa0d6', 'bars'),
];

/** Seconds from "m:ss", so the table below reads like a tracklist. */
function secs(t: string): number {
  const [m, s] = t.split(':').map(Number);
  return m * 60 + s;
}

function cand(
  id: string,
  title: string,
  channel: string,
  length: string,
  kind: ImportCandidate['kind'],
  score: number,
  reasons: [string, boolean][],
  art: number,
): ImportCandidate {
  return {
    id,
    title,
    channel,
    durationSec: secs(length),
    kind,
    score,
    reasons: reasons.map(([text, good]) => ({ text, good })),
    artworkUrl: IMPORT_ART[art % IMPORT_ART.length],
  };
}

const REVIEW: Record<number, Pick<ImportItem, 'flag' | 'candidates'>> = {
  5: {
    flag: 'Two versions are almost tied',
    candidates: [
      cand('c6a', 'Instant Crush (feat. Julian Casablancas)', 'Daft Punk - Topic', '5:37', 'Official audio', 74, [['Length matches', true], ['Same artist', true], ['Title adds the feature', false]], 1),
      cand('c6b', 'Daft Punk - Instant Crush (Official Video) ft. Julian Casablancas', 'Daft Punk', '5:39', 'Music video', 71, [['Length within 2 seconds', true], ["Artist's own channel", true], ['Music video, may have extra sound', false]], 2),
      cand('c6c', 'Instant Crush (Live at the Paris Session)', 'Midnight Sessions', '6:02', 'Live', 38, [['Live version', false], ['Different artist', false], ['25 seconds longer', false]], 3),
    ],
  },
  12: {
    flag: 'A remaster and a live version both match',
    candidates: [
      cand('c13a', 'Dreams (2004 Remaster)', 'Fleetwood Mac - Topic', '4:17', 'Official audio', 69, [['Same recording, remastered', true], ['Length within 3 seconds', true], ['Title says Remaster', false]], 0),
      cand('c13b', 'Fleetwood Mac - Dreams (Official Music Video)', 'Fleetwood Mac', '4:21', 'Music video', 61, [["Artist's own channel", true], ['7 seconds longer', false]], 4),
      cand('c13c', 'Dreams (Live) The Dance 1997', 'Fleetwood Mac', '4:37', 'Live', 44, [['Live version', false], ['23 seconds longer', false]], 5),
      cand('c13d', 'Fleetwood Mac - Dreams (Lyrics)', '7clouds', '4:14', 'Lyric video', 52, [['Length matches', true], ["Not the artist's channel", false]], 2),
    ],
  },
  23: {
    flag: 'Top result is a music video',
    candidates: [
      cand('c24a', 'Take On Me', 'a-ha - Topic', '3:45', 'Official audio', 72, [['Length matches', true], ['Same title and artist', true]], 3),
      cand('c24b', 'a-ha - Take On Me (Official Video) [4K]', 'a-ha', '4:04', 'Music video', 66, [["Artist's own channel", true], ['19 seconds longer', false]], 0),
      cand('c24c', 'a-ha - Take On Me (MTV Unplugged)', 'a-ha', '3:59', 'Live', 41, [['Live, acoustic', false], ['14 seconds longer', false]], 1),
      cand('c24d', 'Take On Me (1984 Version)', 'a-ha - Topic', '3:32', 'Official audio', 55, [['Same artist', true], ['Earlier recording', false], ['13 seconds shorter', false]], 5),
      cand('c24e', 'Take On Me - a-ha (cover)', 'Sofia Lane', '3:48', 'Fan upload', 22, [['Different artist', false], ['Cover version', false]], 4),
    ],
  },
  31: {
    flag: 'Only one result has the right length',
    candidates: [
      cand('c32a', 'Sunset Lover', 'Petit Biscuit - Topic', '3:57', 'Official audio', 68, [['Length matches', true], ['Same title and artist', true]], 3),
      cand('c32b', 'Petit Biscuit - Sunset Lover (Official Video)', 'Petit Biscuit', '4:26', 'Music video', 57, [["Artist's own channel", true], ['29 seconds longer', false]], 0),
      cand('c32c', 'Sunset Lover (1 Hour)', 'Chill Loops', '60:00', 'Fan upload', 12, [['57 minutes longer', false], ["Not the artist's channel", false]], 2),
    ],
  },
};

const NOT_FOUND = new Set([17, 38]);

// [title, artist, album, length], in the playlist's own order.
const IMPORT_ROWS: [string, string, string, string][] = [
  ['Nightcall', 'Kavinsky', 'OutRun', '4:18'],
  ['Midnight City', 'M83', "Hurry Up, We're Dreaming", '4:03'],
  ['Blinding Lights', 'The Weeknd', 'After Hours', '3:20'],
  ['Resonance', 'HOME', 'Odyssey', '3:32'],
  ['A Real Hero', 'College, Electric Youth', 'Drive (Soundtrack)', '4:27'],
  ['Instant Crush', 'Daft Punk, Julian Casablancas', 'Random Access Memories', '5:37'],
  ['The Less I Know The Better', 'Tame Impala', 'Currents', '3:36'],
  ['Tadow', 'Masego, FKJ', 'Tadow', '5:01'],
  ['Redbone', 'Childish Gambino', 'Awaken, My Love!', '5:26'],
  ['Electric Feel', 'MGMT', 'Oracular Spectacular', '3:49'],
  ['Heroes', 'David Bowie', 'Heroes', '6:11'],
  ['Do I Wanna Know?', 'Arctic Monkeys', 'AM', '4:32'],
  ['Dreams', 'Fleetwood Mac', 'Rumours', '4:14'],
  ['Something About Us', 'Daft Punk', 'Discovery', '3:51'],
  ['Starboy', 'The Weeknd, Daft Punk', 'Starboy', '3:50'],
  ['Night Drive', 'Chromatics', 'Night Drive', '4:39'],
  ['Genesis', 'Grimes', 'Visions', '4:15'],
  ['Glass Coast (Demo)', 'Aftertone', 'Low Light Demos', '3:12'],
  ['Moth To A Flame', 'Swedish House Mafia, The Weeknd', 'Paradise Again', '3:54'],
  ['Sweater Weather', 'The Neighbourhood', 'I Love You.', '4:00'],
  ['Nights', 'Frank Ocean', 'Blonde', '5:07'],
  ['After Dark', 'Mr.Kitty', 'Time', '4:17'],
  ['Out of Time', 'The Weeknd', 'Dawn FM', '3:34'],
  ['Take On Me', 'a-ha', 'Hunting High and Low', '3:45'],
  ['Feel It Still', 'Portugal. The Man', 'Woodstock', '2:43'],
  ['Tongue Tied', 'Grouplove', 'Never Trust a Happy Song', '3:38'],
  ['Space Song', 'Beach House', 'Depression Cherry', '5:20'],
  ['Somebody Else', 'The 1975', 'I like it when you sleep', '5:47'],
  ['Borderline', 'Tame Impala', 'The Slow Rush', '3:57'],
  ['Summertime Sadness', 'Lana Del Rey', 'Born To Die', '4:25'],
  ['Kids', 'MGMT', 'Oracular Spectacular', '5:02'],
  ['Sunset Lover', 'Petit Biscuit', 'Sunset Lover', '3:57'],
  ['Innerbloom', 'RÜFÜS DU SOL', 'Bloom', '9:38'],
  ['Pink + White', 'Frank Ocean', 'Blonde', '3:04'],
  ['Turbo Killer', 'Carpenter Brut', 'Trilogy', '3:23'],
  ['Dark All Day', 'GUNSHIP', 'Dark All Day', '4:41'],
  ['Crystalised', 'The xx', 'xx', '3:21'],
  ['Wicked Game', 'Chris Isaak', 'Heart Shaped World', '4:49'],
  ['Late Exit (Unreleased)', 'Coastline', 'Tidewater Sessions', '2:58'],
  ['Lost in Yesterday', 'Tame Impala', 'The Slow Rush', '4:10'],
  ['Intro', 'The xx', 'xx', '2:07'],
  ['Oblivion', 'Grimes', 'Visions', '4:11'],
];

/** The Spotify playlist the import section pastes: 42 songs, of which 36
 *  match confidently, 4 need a look (3 to 5 YouTube candidates each) and 2
 *  are not on YouTube at all. Positions follow the source. */
export const MOCK_IMPORT_ITEMS: ImportItem[] = IMPORT_ROWS.map(([title, artist, album, length], i) => ({
  id: `imp-${i + 1}`,
  title,
  artist,
  album,
  durationSec: secs(length),
  status: REVIEW[i] ? 'review' : NOT_FOUND.has(i) ? 'not-found' : 'matched',
  ...(REVIEW[i] ?? {}),
}));

/** What the link preview shows once a link is pasted. */
export interface ImportSource {
  id: 'spotify' | 'ytm' | 'spotify-long';
  kind: 'spotify' | 'ytm';
  url: string;
  name: string;
  owner: string;
  songCount: number;
  cover: string;
}

export const MOCK_IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'spotify',
    kind: 'spotify',
    url: 'https://open.spotify.com/playlist/37i9dQZF1DX6GJXiuZRisr',
    name: 'Late night drive',
    owner: 'Maya Okafor',
    songCount: MOCK_IMPORT_ITEMS.length,
    cover: IMPORT_ART[0],
  },
  {
    id: 'ytm',
    kind: 'ytm',
    url: 'https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    name: 'Late night drive',
    owner: 'Maya Okafor',
    songCount: MOCK_IMPORT_ITEMS.length,
    cover: IMPORT_ART[0],
  },
  {
    id: 'spotify-long',
    kind: 'spotify',
    url: 'https://open.spotify.com/playlist/5S8SJdl1BDc0ugpkEvFsIL',
    name: 'Every synthwave song ever',
    owner: 'nightrunner',
    songCount: 318,
    cover: IMPORT_ART[2],
  },
];

/** The import's running state in the Importing step. */
export const MOCK_IMPORT_PROGRESS = { done: 18, total: MOCK_IMPORT_ITEMS.length };

/** Art for a matched row, so the playlist page is not a column of black
 *  squares. */
export function importArt(i: number): string {
  return IMPORT_ART[i % IMPORT_ART.length];
}
/** Tabs v3 on /dizajn (docs/tabs-v3.md): every tab Ember could find for the
 *  now-playing "Copper Sky" by Coastline (an invented song), in the rank
 *  order the picker lists them. Nothing here is fetched; the names, ratings
 *  and votes are made up. One long name and one long instrument list prove
 *  the rows truncate or wrap instead of overflowing. */
export type MockTabSite = 'songsterr' | 'ug' | 'server';

export interface MockTabSource {
  id: string;
  site: MockTabSite;
  /** "Songsterr", "Ultimate Guitar", "On this server". */
  siteLabel: string;
  /** "Tab with rhythm", "Text tab", "Bass tab", "Pasted text tab". */
  type: string;
  name: string;
  rating?: number;
  votes?: number;
  instruments: string[];
  /** Alignment with the recording: confidence 0..100, or null when it has
   *  not been lined up yet. */
  lined: number | null;
  /** The chip label when this one is drawn. */
  chip: string;
  /** Which two bars the source sheet previews. */
  preview: 'guitar' | 'bass' | 'rough';
}

export const MOCK_TAB_SOURCES: MockTabSource[] = [
  {
    id: 'songsterr-1',
    site: 'songsterr',
    siteLabel: 'Songsterr',
    type: 'Tab with rhythm',
    name: 'Copper Sky',
    instruments: ['Guitar', 'Bass', 'Drums'],
    lined: 94,
    chip: 'Songsterr',
    preview: 'guitar',
  },
  {
    id: 'ug-1',
    site: 'ug',
    siteLabel: 'Ultimate Guitar',
    type: 'Text tab',
    name: 'Copper Sky (ver 2)',
    rating: 4.8,
    votes: 1204,
    instruments: ['Guitar'],
    lined: 81,
    chip: 'Ultimate Guitar, ver 2',
    preview: 'guitar',
  },
  {
    id: 'ug-2',
    site: 'ug',
    siteLabel: 'Ultimate Guitar',
    type: 'Text tab',
    name: 'Copper Sky',
    rating: 4.5,
    votes: 310,
    instruments: [
      'Rhythm Guitar',
      'Lead Guitar (Fender Jaguar, fuzz)',
      'Acoustic Guitar',
      '12-string Guitar (intro only)',
      'Baritone Guitar',
    ],
    lined: null,
    chip: 'Ultimate Guitar',
    preview: 'guitar',
  },
  {
    id: 'ug-3',
    site: 'ug',
    siteLabel: 'Ultimate Guitar',
    type: 'Bass tab',
    name: 'Copper Sky (live at the Harbour Room, full bass line with the extended outro and the fills)',
    rating: 3.9,
    votes: 22,
    instruments: ['Bass'],
    lined: null,
    chip: 'Ultimate Guitar, bass',
    preview: 'bass',
  },
  {
    id: 'pasted-1',
    site: 'server',
    siteLabel: 'On this server',
    type: 'Pasted text tab',
    name: 'Text tab pasted by Mira',
    instruments: ['Guitar'],
    lined: 72,
    chip: 'Text tab pasted by Mira',
    preview: 'guitar',
  },
  {
    id: 'generated-1',
    site: 'server',
    siteLabel: 'On this server',
    type: 'Generated, rough',
    name: 'Generated from the recording, rough',
    instruments: ['Guitar'],
    lined: 100,
    chip: 'Generated from the recording, rough',
    preview: 'rough',
  },
];

/** Confidence under this reads "not lined up yet" (docs/tabs-v3.md 3). */
export const MOCK_LINED_THRESHOLD = 60;

/** The Songsterr match when Ember could not line it up with confidence. */
export const MOCK_NOT_LINED_CONFIDENCE = 41;
