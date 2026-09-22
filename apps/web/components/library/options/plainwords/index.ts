import type { PickerOption } from '@/components/library/options';
import { YTMUSIC_HEADERS_NOTE, YTMUSIC_HEADERS_STEPS } from '@/lib/import/sources/ytmusicLiked';

/** Design candidates for a plain-words Transfer dialog: ask "Where is your
 *  music now?" first, then show only that service's steps. Nothing here is
 *  wired to a real transfer; the routes and their limits are the real ones
 *  Ember can do (docs in the plan this ships from), the numbers on the
 *  result screens are made up. */

export type PlainWordsServiceId = 'spotify' | 'ytmusic' | 'apple' | 'other';
export type PlainWordsCandidateId = 'one-way' | 'two-way' | 'what-you-have';
export type PlainWordsStateId = 'asking' | 'steps' | 'result';

/** One real way to bring songs in from a service. `steps` are numbered by
 *  their position, so the array order is the order shown. */
export interface PlainWordsRoute {
  id: string;
  /** Named for the "other ways" link and the two-way choice card. */
  label: string;
  /** Named for the "what do you have" big option. */
  whatYouHave: string;
  /** One line: what this route costs against what it gets you. */
  tradeoff: string;
  steps: string[];
  /** True only for the YouTube Music headers route: no phone browser can
   *  do developer tools, so it is an honest dead end there. */
  desktopOnly?: boolean;
  /** Mock result numbers. */
  found: number;
  check: number;
  notFound: number;
  /** Sample-only cap, e.g. Spotify's 100-song playlist-link limit. */
  cap?: number;
  /** Extra trust copy under the steps, e.g. what Ember does with a pasted
   *  session. */
  note?: string;
}

export interface PlainWordsService {
  id: PlainWordsServiceId;
  name: string;
  /** First route is the easiest/quick default; a second route (if any) is
   *  the slower/exact alternative. */
  routes: PlainWordsRoute[];
}

export const PLAINWORDS_SERVICES: PlainWordsService[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    routes: [
      {
        id: 'csv',
        label: 'Upload a file a converter made',
        whatYouHave: 'A file someone gave me, or one I downloaded',
        tradeoff: 'Works right now, and brings in your whole library.',
        steps: [
          'Go to a free site like Exportify, Soundiiz or TuneMyMusic and sign in with Spotify.',
          'Export your Liked Songs as a CSV file.',
          'Come back here and upload that file.',
        ],
        found: 812,
        check: 41,
        notFound: 6,
      },
      {
        id: 'export',
        label: "Spotify's own data export",
        whatYouHave: 'Nothing yet, but I can wait a few days',
        tradeoff: "The exact list Spotify has for you, but it takes a few days to arrive.",
        steps: [
          'On Spotify, go to Account, then Privacy settings.',
          'Choose "Download your data" and ask for it. Spotify emails you in a few days.',
          'Unzip what you get and find the file called YourLibrary.json.',
          'Come back here and upload that file.',
        ],
        found: 812,
        check: 12,
        notFound: 3,
      },
      {
        id: 'playlist-link',
        label: 'Paste a link to a playlist',
        whatYouHave: 'A link to a playlist',
        tradeoff: 'The fastest way, but only the first 100 songs come across.',
        steps: [
          'In Spotify, make a new playlist and add your liked songs to it.',
          'Make that playlist public and copy its link.',
          'Paste the link here.',
        ],
        found: 100,
        check: 9,
        notFound: 2,
        cap: 100,
      },
    ],
  },
  {
    id: 'ytmusic',
    name: 'YouTube Music',
    routes: [
      {
        id: 'playlist-link',
        label: 'Paste a link to a playlist',
        whatYouHave: 'A link to a playlist',
        tradeoff: 'Works from a phone, but songs are matched by name.',
        steps: [
          'In YouTube Music, make a playlist from your liked songs (Library, then Liked, then add them all to a new playlist).',
          'Make the playlist public and copy its share link.',
          'Paste the link here.',
        ],
        found: 340,
        check: 12,
        notFound: 3,
      },
      {
        id: 'headers',
        label: 'Copy some technical info from your browser',
        whatYouHave: "I'm on a computer and don't mind a technical step",
        tradeoff: 'Gets every song exactly right, but needs a desktop browser.',
        steps: [...YTMUSIC_HEADERS_STEPS],
        desktopOnly: true,
        found: 340,
        check: 0,
        notFound: 0,
        note: YTMUSIC_HEADERS_NOTE,
      },
    ],
  },
  {
    id: 'apple',
    name: 'Apple Music',
    routes: [
      {
        id: 'privacy-export',
        label: "Apple's privacy data export",
        whatYouHave: 'A file Apple sent me',
        tradeoff: 'The only way, but it takes a few days to arrive.',
        steps: [
          'On an iPhone, or at privacy.apple.com, request a copy of your data and choose Apple Media Services.',
          "Wait for Apple's email (it can take a few days) and download the file it links to.",
          'Unzip it and find the CSV file with your liked songs.',
          'Come back here and upload that CSV.',
        ],
        found: 205,
        check: 9,
        notFound: 2,
      },
    ],
  },
  {
    id: 'other',
    name: 'Somewhere else',
    routes: [
      {
        id: 'paste',
        label: 'Type or paste a list',
        whatYouHave: 'Just a list I can type out',
        tradeoff: 'The fastest way if you already know the songs.',
        steps: ['Write down your songs, one per line, like "Artist - Title".', 'Paste that list here.'],
        found: 58,
        check: 5,
        notFound: 1,
      },
      {
        id: 'csv',
        label: 'Upload a file',
        whatYouHave: 'A file someone gave me',
        tradeoff: 'No typing, and it matches the names exactly as written in the file.',
        steps: ['Get the file with your songs, from a friend or another app, as a CSV.', 'Come back here and upload it.'],
        found: 64,
        check: 4,
        notFound: 0,
      },
    ],
  },
];

export const PLAINWORDS_SERVICE_OPTIONS: (PickerOption & { id: PlainWordsServiceId })[] = PLAINWORDS_SERVICES.map(
  (s) => ({
    id: s.id,
    name: s.name,
    description:
      s.routes.length > 1
        ? `${s.routes.length} real ways in: ${s.routes.map((r) => r.label).join(', ')}.`
        : `One real way in: ${s.routes[0].label}.`,
  }),
);

export const PLAINWORDS_STATES: (PickerOption & { id: PlainWordsStateId })[] = [
  { id: 'asking', name: 'Asking', description: 'The dialog just opened: "Where is your music now?"' },
  { id: 'steps', name: 'Steps shown', description: 'A service is picked and its plain-words steps are on screen.' },
  { id: 'result', name: 'Result', description: 'Ember read what was given and says what it found, in plain words.' },
];

/** What the choice screen (two-way's Quick/Exact, or the whole
 *  what-you-have screen) shows for a route without a second route to
 *  contrast it with (Apple Music today): nothing, the steps show at once. */
export function routeById(service: PlainWordsService, id: string | null): PlainWordsRoute {
  return service.routes.find((r) => r.id === id) ?? service.routes[0];
}

/** The result screen's sentence, in plain words rather than raw counts:
 *  "We found 812 songs. 41 need a quick check, 6 we could not find." An
 *  exact route (nothing to check, nothing missing) gets its own sentence. */
export function plainResultCopy(route: PlainWordsRoute): string {
  const bits: string[] = [];
  if (route.check > 0) bits.push(`${route.check} need a quick check`);
  if (route.notFound > 0) bits.push(`${route.notFound} we could not find`);
  if (bits.length === 0) return `We found all ${route.found} of your songs. Nothing to check.`;
  return `We found ${route.found} songs. ${bits.join(', ')}.`;
}

export interface PlainWordsCandidate extends PickerOption {
  id: PlainWordsCandidateId;
  /** One-line pitch shown under the candidate's name on /dizajn. */
  pitch: string;
}

export const PLAINWORDS_CANDIDATES: PlainWordsCandidate[] = [
  {
    id: 'one-way',
    name: 'One way each',
    pitch: 'Pick your service, get the single easiest route as numbered steps; everything else hides behind "other ways".',
    description:
      'After the service is picked, Ember shows only the easiest route as numbered steps. A small "other ways in" link folds the rest away, for the rare person who already has a playlist link or a file instead.',
  },
  {
    id: 'two-way',
    name: 'Two named choices',
    pitch: '"The quick way" or "the exact way", each with a one-line trade-off, then the steps.',
    description:
      'After the service is picked, two named cards: "The quick way" and "the exact way" (where a service has both), each with a one-line trade-off, then the steps for whichever is chosen. A service with only one real way skips the choice.',
  },
  {
    id: 'what-you-have',
    name: 'What do you have?',
    pitch: 'After the service, one plain question about what is already in hand, not which technical route to take.',
    description:
      'After the service is picked, Ember asks "What do you have already?" in big plain options ("A link to a playlist", "A file someone gave me") instead of naming a route. Nobody has to judge "quick" against "exact": they just say what is sitting in front of them and Ember picks the matching steps.',
  },
];

export const PLAINWORDS_RECOMMENDED: PlainWordsCandidateId = 'what-you-have';

export const PLAINWORDS_RECOMMENDED_REASON =
  'A friend does not know if a playlist link is "quick" or "exact", but they do know what is already in front of them: a link, a file, or nothing but memory. Asking "what do you have?" turns the decision into a fact instead of a judgment call, and it still reaches every route the other two candidates reach, including the desktop-only exact route for YouTube Music.';

