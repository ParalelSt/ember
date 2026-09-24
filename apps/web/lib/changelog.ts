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
    id: 'normalize-volume',
    version: '0.7.10',
    date: '2026-09-24',
    title: 'Every song at the same volume',
    summary: 'Songs now play at about the same loudness, so you do not have to reach for the volume when a quiet one comes on.',
    bullets: [
      'Each song is measured once after it is first played, and loud ones are turned down (quiet ones up) to match.',
      'The song itself is never changed. Turn it off in Settings > Plugins > Normalize volume.',
      'Works in the browser and the desktop app. The Android app does not have it yet.',
    ],
  },
  {
    id: 'web-fixes-5',
    version: '0.7.9',
    date: '2026-09-24',
    title: 'Web app fixes',
    summary: 'Big uploads work, an expired sign-in takes you to sign in, Search shows what is trending, and long names wrap.',
    bullets: [
      'Uploading a song file bigger than about 12 MB works again, up to the 50 MB limit.',
      'When your sign-in has expired, the app takes you to the sign-in page instead of showing errors, and brings you back to where you were.',
      'The Search page shows real trending songs before you type anything.',
      'Long playlist, album and artist names wrap onto a few lines instead of running off the page.',
      'On a phone, Settings brings the tab you are on into view, and Admin > Users stacks each person neatly.',
      'Looking at a transfer preview, or a feature or fix request that did not go through, no longer uses up your hourly tries.',
      'A playlist name that is too long gets a plain message instead of a raw error.',
      'Downloading a song with a non-English title works.',
      'Guitar tab generation shows as working right away, and leaves no junk files behind if it gets stuck.',
    ],
  },
  {
    id: 'server-fixes-4',
    version: '0.7.8',
    date: '2026-09-24',
    title: 'Server fixes',
    summary: 'Fewer songs greyed out by mistake, imports that finish, clearer search errors, and Android controls that stay clear of the phone\'s buttons.',
    bullets: [
      'When YouTube briefly limits the server, songs no longer turn grey as if they were gone for good.',
      'A playlist or likes import no longer gets stuck on one odd song or a short network hiccup.',
      'When search cannot reach YouTube, you see an error instead of "no results", and the next search tries again. Your own uploads still show up.',
      'Old cached songs that nothing uses any more get cleaned up, so the server does not slowly fill up.',
      'On Android, the menu and the sheets that slide up now sit above the phone\'s buttons instead of under them.',
      'The Android fix needs the new app version, 0.4.7.',
    ],
  },
  {
    id: 'app-fixes-3',
    version: '0.7.7',
    date: '2026-09-24',
    title: 'App fixes',
    summary: 'The Android and desktop apps handle the awkward moments better: broken songs, the car, calls, Back, and no connection.',
    bullets: [
      'On Android and in the car, a song that will not play is skipped and the next one starts, instead of the music stopping. Without a connection, the app still plays what is saved on the phone, as before.',
      'In the car, tapping a song plays the rest of the list you tapped it in, not another tab.',
      'Opening the Android app no longer adds a play you did not make, or drops the playlist you were in.',
      'Back on Android closes the player or search, or goes to the previous page, instead of closing the app.',
      'Prank sounds never play during a phone call.',
      'The desktop app shows a Retry page when it cannot reach Ember at launch, and loads Ember by itself once it can.',
      'The desktop media widget (Now Playing, the Windows media overlay) shows a scrubber and the song length, and says Stopped when the music runs out.',
      'Clearing the queue on the desktop app while a song is still loading keeps it quiet.',
      'These fixes need the new app version, 0.4.6.',
    ],
  },
  {
    id: 'playback-fixes-2',
    version: '0.7.6',
    date: '2026-09-24',
    title: 'Playback fixes',
    summary: 'Repeat, shuffle and seeking behave the way you expect, on the desktop app and on Android.',
    bullets: [
      'Repeat one on the desktop app plays the song again, with sound, instead of sitting silent at 0:00.',
      'The loop button on Android now really loops (one song or the whole list), and the Repeat button in the car or the notification shows on it.',
      'On Android, turning shuffle on or off or removing another song no longer restarts the song that is playing, and tapping a song starts it once, without a stutter.',
      'Seeking right after a song starts goes where you tapped instead of back to 0:00.',
      'Radio no longer mixes in songs meant for the queue you just left.',
      'A new song no longer starts at the time the previous one was at after you reopen the app, and shuffle starts off after a reload so turning it off always puts the list back in order.',
      'Skipping around in a song is more reliable in the desktop app and some browsers.',
      'The desktop and Android fixes need the new app version, 0.4.5.',
    ],
  },
  {
    id: 'security-fixes-1',
    version: '0.7.5',
    date: '2026-09-24',
    title: 'Security fixes',
    summary: 'Security fixes: Ember checks more carefully who is asking before it lets anything change.',
    bullets: [
      'The server now confirms your sign-in with the database on every request, and only the server can change shared song details, uploads, admin rights and carlists.',
      'The database admin screen is no longer reachable from the internet, and its password now lives only in the host\'s settings, not in the code.',
      'Busy moments are handled better: searches and song lookups take turns instead of piling up, and a sign-in link can only send you back to a page on Ember.',
      'The desktop app gets its part of the fix in the new app version, 0.4.4. Nothing changes in how you use Ember.',
    ],
  },
  {
    id: 'auto-cache-offline',
    version: '0.7.4',
    date: '2026-09-24',
    title: 'Keeps playing when the internet drops',
    summary: 'Keeps playing when the internet drops: Ember saves the next couple of songs as you listen, so a dropped connection does not stop the music.',
    bullets: [
      'While a song plays, Ember quietly saves it and the next two on your device. They play from there, even online, so they start at once and use no data.',
      'Offline, songs that were not saved are skipped and an Offline badge shows in the player. When nothing saved is left, the music pauses and picks up again once you are back online.',
      'It waits for Wi-Fi by default. Settings > Downloads has the switch, "Also on mobile data", how much space it uses, and a button to clear it.',
      'In the desktop and Android apps it needs the new app version, 0.4.3. On Android it keeps working with the screen off and in the car.',
    ],
  },
  {
    id: 'playlist-copy',
    version: '0.7.3',
    date: '2026-09-24',
    title: 'Copy songs between playlists',
    summary: 'Pick songs in a playlist or Liked songs and copy them anywhere, with duplicates skipped.',
    bullets: [
      'Select: tap Select above the songs, then tick them one by one or Select all.',
      'Sort any playlist by title, artist, date added or duration, either way round. Each playlist remembers its sort on your device.',
      'Copy to another playlist, a new one, or Liked songs. Copying into Liked songs likes every song, and Ember asks first.',
      'Songs already there are skipped, including another upload of the same song. Different songs that only share a title are both copied.',
    ],
  },
  {
    id: 'playback-reliability',
    version: '0.7.2',
    date: '2026-09-24',
    title: 'Songs start reliably in the desktop app again',
    summary: 'Fewer songs stall or fail to start, especially on slower connections.',
    bullets: [
      'Fewer stalls on slower connections: the desktop app now waits for the song a little longer before it gives up.',
      'A song now loads once instead of twice when you press play, skip or it moves on to the next one.',
      'Pressing pause while a song is still loading is respected, and pressing play after a song failed to load tries it again.',
      'Guitar tabs: the score redraws cleanly when you resize the window, and songs with no tabs online no longer show up as errors.',
      'The desktop fixes need the new desktop app (0.4.2).',
    ],
  },
  {
    id: 'floating-top-bar',
    version: '0.7.1',
    date: '2026-09-24',
    title: 'A cleaner top bar on desktop',
    summary: 'The page scrolls under the search bar, which now floats clear of what is under it.',
    bullets: [
      'On a computer, the page now slides away under the search bar as you scroll, and the scroll bar runs from the very top of the window.',
      'Whatever scrolls under the search bar fades out a little below it, so it never looks cut off.',
      'Nothing moves when you are at the top of a page, and phones stay exactly as they were.',
    ],
  },
  {
    id: 'themes',
    version: '0.7.0',
    date: '2026-09-23',
    title: 'Make Ember yours',
    summary: 'Five themes and your own colours, in Settings, under Appearance.',
    bullets: [
      'Pick one of five themes: Ember (the red on black you know), Midnight, Forest, Nebula or Mono, which is pure black for OLED phones.',
      'Or make your own: choose a background, an accent and a text colour and Ember fills in the rest. Whatever you pick or change shows on the small preview first; press Apply to use it on the whole app, or Back to current to leave things as they were.',
      'If two colours would be hard to read together, Ember tells you and offers a fix. It never changes your colours by itself.',
      'Keep up to 20 themes of your own, and share any of them with everyone here. Themes others share show up with their name, ready to use or copy.',
      'Your theme follows your account to the web, the desktop app and your phone, from the very first moment a page loads. On your phone the status bar matches it too, and so does the desktop window.',
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
