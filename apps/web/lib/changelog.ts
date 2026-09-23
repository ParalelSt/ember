import { isNewer } from '@/lib/semver';

/** The user-facing changelog, newest first. Plain data: no parsing, no build
 *  step, imported by the "What's new" page and by tests. See
 *  docs/changelog-system.md for how a version is cut. */
export interface ChangelogEntry {
  /** Stable, e.g. 'instant-search'. */
  id: string;
  /** App version this shipped in, '0.3.0'. */
  version: string;
  /** ISO date, '2026-09-18'. */
  date: string;
  title: string;
  /** One line. */
  summary: string;
  /** Two or three short lines for the full page. */
  bullets: string[];
  /** Omit for the web app (which every shell shows too). */
  scope?: 'desktop' | 'android';
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: 'themes',
    version: '0.7.0',
    date: '2026-09-23',
    title: 'Make Ember yours',
    summary: 'Five themes and your own colours, in Settings, under Appearance.',
    bullets: [
      'Pick one of five themes: Ember (the red on black you know), Midnight, Forest, Nebula or Mono, which is pure black for OLED phones.',
      'Or make your own: choose a background, an accent and a text colour and Ember fills in the rest. You see the change on the whole app as you go, and it saves itself.',
      'If two colours would be hard to read together, Ember tells you and offers a fix. It never changes your colours by itself.',
      'Keep up to 20 themes of your own, and share any of them with everyone here. Themes others share show up with their name, ready to use or copy.',
      'Your theme follows your account to the web, the desktop app and your phone, from the very first moment a page loads. On your phone the status bar matches it too, and so does the desktop window.',
      'On desktop, the search bar now has a small gap under it, with a soft fade where a scrolled page meets it, instead of content running straight up to its bottom edge.',
    ],
  },
  {
    id: 'admin-pranks-tab',
    version: '0.6.0',
    date: '2026-09-23',
    title: 'A Pranks tab for admins',
    summary: 'Admins get a new Pranks tab in the admin pages.',
    bullets: [
      'Admins get a new Pranks tab in the admin pages, alongside the other admin tools.',
    ],
  },
  {
    id: 'desktop-stream-stall',
    version: '0.5.1',
    date: '2026-09-23',
    title: 'Long songs load again on desktop',
    summary: 'The desktop app no longer gives up with "Couldn\'t load" on long songs.',
    bullets: [
      'Some songs, mostly long ones, failed to start in the desktop app while they played fine in a browser. They now start straight away, from one download instead of dozens of small ones.',
      'If a song does get stuck while loading, the app tries once more on its own before telling you.',
      'Needs the new desktop app (0.4.1).',
    ],
  },
  {
    id: 'transfer-liked-songs',
    version: '0.5.0',
    date: '2026-09-23',
    title: 'Bring your liked songs over',
    summary: 'Move the songs you liked on Spotify, YouTube Music, Apple Music or anywhere else into Ember, from Settings, under Library.',
    bullets: [
      'Ember asks two plain questions, where your music is now and what you already have, and then shows only the steps for your answer.',
      'YouTube Music: sign in with Google using a short code, from any phone or computer. Ember reads your likes once, keeps the songs, and gives the permission back straight away.',
      'Spotify and Apple Music: upload the list they let you download (or one from a site like Exportify), or paste a public playlist link. Anywhere else: paste a list of songs, one per line.',
      'You see what Ember found before anything starts, the Liked songs page shows the transfer as it runs, and anything Ember was unsure about waits in a short list for you to check.',
      'Songs you bring over sit below the ones you liked yourself, in the order you liked them.',
      'Liking a song no longer lights up every other song with the same name by a different artist, for artists whose names are not in the Latin alphabet and for songs with no artist listed.',
      'Ember now has a privacy policy and terms, in plain words.',
      'Radio, song details and downloads work again for the few songs whose YouTube id starts with a dash.',
    ],
  },
  {
    id: 'native-voice-search',
    version: '0.4.0',
    date: '2026-09-22',
    title: 'Voice search in the apps',
    summary: 'The mic in the search box now works in the Android app and on the desktop, using your device\'s own speech recognition.',
    bullets: [
      'Tap the mic and speak; the words fill the search box as you say them, and the search runs when you stop.',
      'Android uses the phone\'s own recognizer, macOS uses Apple\'s (on the device where it can), Windows uses Microsoft\'s and needs the Online speech recognition setting turned on.',
      'The first use asks for microphone access. Older app builds show a note to update.',
    ],
  },
  {
    id: 'guitar-tabs',
    version: '0.4.0',
    date: '2026-09-20',
    title: 'Guitar tabs, properly',
    summary: 'Ember finds guitar tabs for your songs by itself, lines them up with the recording, and shows them on a page that follows along as the song plays.',
    bullets: [
      'Open a song and Ember looks for its tab online by itself: Songsterr tabs, with real rhythm and every instrument in one tab, and Ultimate Guitar text tabs. Whatever it finds is kept for everyone on your server.',
      'A tab lines itself up with the recording, so it sits where the band actually plays, even when they drift; every tab found for a song sits in one list you can open and pick from, and Ember draws the one that matches best.',
      'The tab page follows the song: click a bar to jump there, or drag the line anywhere and watch the time as you go. Switch between guitar and bass, show Tab or Tab and Score together, or turn the page sideways. You can paste in a text tab yourself, and when nothing is found, one click searches the tab sites for the song.',
      'Tabs can be switched off in Settings, under Plugins, and plugin settings now follow your account, so a switch you flip on your phone is flipped on your computer too.',
      'Nothing to install on the server for this: Ember now brings its own copy of ffmpeg.',
      'A song Ember cannot load now says so in a couple of seconds, and names the song, instead of freezing the player for half a minute.',
      'Radio works for every song now: a small group of songs used to fail to start one.',
      'An instrumental, live or remixed version is kept apart from the original, so liking one no longer lights up the other and radio stops mistaking them for each other.',
      'On a phone, the song name in the full-screen player is readable again: long titles had been drawn on top of themselves, and now they sit still for a moment and then scroll across once, the way they used to.',
      'The player bar on a phone is back to one clean row: the artwork, the song name with room to actually read it (it scrolls when it is too long for even that), and play and next buttons. Previous and the queue are in the full-screen player, which opens when you tap the bar. The bar and the row of Home, Search and Library now sit clear of the Android buttons at the bottom of the screen instead of hiding behind them.',
      'Bug reports and requests can carry up to 4 screenshots or short clips (10 MB in total); they land in Discord with the message.',
    ],
  },
  {
    id: 'search-without-losing-your-place',
    version: '0.3.11',
    date: '2026-09-20',
    title: 'Search without losing your place',
    summary: 'Search now opens under the search box instead of taking over the screen, so the player and the rest of the app keep working while it is open.',
    bullets: [
      'On a computer there is a search box at the top of every page, and the results drop down under it.',
      'Nothing behind it is blocked any more: pause, skip, change the volume or open a playlist without closing search first.',
      'Starting a song from a result leaves search open, so you can keep looking. Press Escape or click anywhere else to close it.',
      'On a phone search still opens full screen, which is the right thing on a small screen.',
    ],
  },
  {
    id: 'play-from-search',
    version: '0.3.10',
    date: '2026-09-20',
    title: 'Play straight from search',
    summary: 'Search results and recent searches now have a play button, and the song playing shows in the accent colour.',
    bullets: [
      'Every row in the search box has a play button at its right end: point at a row, or tab to it, and press play.',
      'The song playing keeps its button showing, so the same press pauses it and presses again to carry on.',
      'That song’s title is in the ember accent, in both the search results and your recent searches, so you can see which row is playing.',
    ],
  },
  {
    id: 'trending-fits-better',
    version: '0.3.6',
    date: '2026-09-19',
    title: 'Trending fits better',
    summary: 'The Trending shelf now mixes the US, UK, German and Serbian charts instead of the worldwide one.',
    bullets: [
      'The worldwide chart leaned heavily toward one country’s taste; the shelf now blends several countries’ charts instead.',
      'A host can pick their own mix with TRENDING_COUNTRIES.',
    ],
  },
  {
    id: 'spotify-imports-work-again',
    version: '0.3.5',
    date: '2026-09-19',
    title: 'Spotify imports work again',
    summary: 'Spotify playlist links import again with no setup, in the background, and unsure songs wait for you to check.',
    bullets: [
      'Paste any public Spotify playlist link: the first 100 songs import, no keys needed.',
      'Start an import from the new-playlist button: it runs in the background, with its progress in the sidebar.',
      'Better song matching: length, artist, explicit and live or remix versions all count.',
      'Songs Ember is unsure about are never guessed: check them one by one, and re-match any imported song later.',
    ],
  },
  {
    id: 'real-trending',
    version: '0.3.4',
    date: '2026-09-19',
    title: 'Real trending songs',
    summary: "The Trending shelf on Home now shows YouTube Music's actual daily chart, refreshed every few hours.",
    bullets: [
      "Trending right now on Home is today's YouTube Music chart, in chart order.",
      'It refreshes every few hours, and keeps showing the last chart if YouTube is slow to answer.',
      'Search shows the same chart before you type.',
    ],
  },
  {
    id: 'search-fits-smaller-screens',
    version: '0.3.3',
    date: '2026-09-19',
    title: 'Search fits smaller screens',
    summary: 'Song titles in the search pop-up no longer get cut short on smaller or zoomed screens.',
    bullets: [
      'The search pop-up now sizes its rows to its own width, not the window.',
      'Song titles show in full on smaller screens and at higher Windows zoom levels.',
    ],
  },
  {
    id: 'profile-pictures-load-everywhere',
    version: '0.3.2',
    date: '2026-09-19',
    title: 'Profile pictures load everywhere',
    summary: 'Fixed pictures showing as a broken image in the admin user list and right after changing your picture.',
    bullets: [
      'Your picture no longer shows as a broken image in the admin user list.',
      'Your picture shows right away after you change it, from any device.',
    ],
  },
  {
    id: 'cleaner-collection-pages',
    version: '0.3.1',
    date: '2026-09-18',
    title: 'Cleaner collection pages',
    summary: 'More breathing room around the play buttons on your collection pages.',
    bullets: [
      'Liked songs, playlists, albums, artists and tracks get more room around the play buttons.',
      'Every one of those pages now shares the same even spacing.',
    ],
  },
  {
    id: 'instant-search',
    version: '0.3.0',
    date: '2026-09-18',
    title: 'Instant search',
    summary: 'Search opens straight away, even on a slow connection.',
    bullets: [
      'Search opens the moment you tap it, even on a slow connection.',
      'Your recent searches show while results load.',
    ],
  },
  {
    id: 'loading-skeletons',
    version: '0.3.0',
    date: '2026-09-18',
    title: 'Smoother loading',
    summary: 'Pages show their shape while they load instead of a blank screen.',
    bullets: [
      'Pages show a light outline of what is coming while they load.',
      'No more blank screen before your music appears.',
    ],
  },
  {
    id: 'desktop-seek-fix',
    version: '0.3.0',
    date: '2026-09-18',
    title: 'Seeking works in the desktop app',
    summary: 'Jumping to a point in a song now lands where you clicked.',
    bullets: [
      'Clicking or dragging on the progress bar jumps to the right spot.',
      'Update the desktop app to get this fix.',
    ],
    scope: 'desktop',
  },
  {
    id: 'send-a-request',
    version: '0.3.0',
    date: '2026-09-18',
    title: 'Ask for a feature or a fix',
    summary: 'Send an idea or a fix request from Settings > Help.',
    bullets: [
      'Go to Settings > Help and tap Send a request.',
      'Pick a new feature or a fix, describe it, and send.',
    ],
  },
  {
    id: 'auto-crash-reports',
    version: '0.3.0',
    date: '2026-09-18',
    title: 'Automatic crash reports',
    summary: 'When something breaks, Ember can let us know by itself.',
    bullets: [
      'If something crashes, a short report is sent so it can be fixed.',
      'Turn it off any time in Settings > Help.',
    ],
  },
];

/** The app's version: always the newest entry. A unit test keeps this equal
 *  to apps/web/package.json. */
export const APP_VERSION = CHANGELOG[0].version;

/** Ids of the entries that carry a New tag: everything released after the
 *  version the user last marked read. An empty `seen` means "not known yet"
 *  (not loaded, or a brand new user before the first write), which shows
 *  nothing as New. Hiding tags empties the set. */
export function computeNewIds(
  entries: ChangelogEntry[],
  seen: string | null | undefined,
  hideNew: boolean,
): string[] {
  if (hideNew || !seen) return [];
  return entries.filter((e) => isNewer(e.version, seen)).map((e) => e.id);
}
