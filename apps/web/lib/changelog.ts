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
    id: 'real-trending',
    version: '0.3.2',
    date: '2026-09-18',
    title: 'Real trending songs',
    summary: "The Trending shelf on Home now shows YouTube Music's actual daily chart, refreshed every few hours.",
    bullets: [
      "Trending right now on Home is today's YouTube Music chart, in chart order.",
      'It refreshes every few hours, and keeps showing the last chart if YouTube is slow to answer.',
      'Search shows the same chart before you type.',
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
