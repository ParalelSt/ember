import type { TabMatch } from '@/lib/songsterr';
import { isLinedUp, type TabTiming } from '@/lib/tabSync';

/** The tab store's shapes and the source chain, without the server: the
 *  routes (lib/tabStore.ts) build these, the tab page (/tabs/[trackId])
 *  picks from them. */

/** Where a tab came from: a Guitar Pro or MusicXML file someone added, a
 *  text tab someone pasted (kept as alphaTex beside the original text), or
 *  a tab Ember found online. docs/tab-sources.md section 4.
 *
 *  Older servers also wrote tabs generated from the recording (row kind
 *  "generated"). They were too rough to keep: the store leaves them out
 *  (lib/tabStore.ts) and the page never draws one. */
export type TabKind = 'file' | 'pasted' | 'fetched';

/** The kinds the page draws, in the order it tries them. */
export const DRAWN_KINDS: readonly TabKind[] = ['file', 'pasted', 'fetched'];

/** Where a fetched tab was found: the site's page and what it said of the
 *  tab. Null for every other kind. */
export interface TabOnlineSource {
  site: 'ug' | 'songsterr';
  /** "Ultimate Guitar", "Songsterr". */
  siteLabel: string;
  url: string;
  /** Guitar tab or bass tab; Songsterr's hold every instrument ("multi"). */
  part: 'guitar' | 'bass' | 'multi';
  /** Songsterr: the instruments in the file, in order ("Rhythm Guitar"). */
  instruments?: string[];
  /** The site's version number of this song's tab (UG: "ver 2"). */
  version: number;
  rating: number | null;
  votes: number | null;
}

/** One row of the tab store as the client sees it. */
export interface TabSummary {
  id: string;
  kind: TabKind;
  title: string;
  artist: string;
  instrument: string | null;
  trackId: string | null;
  /** '.gp5', '.musicxml', '.alphatex' ... */
  ext: string;
  format: string;
  /** Visible to everyone on the server. */
  shared: boolean;
  /** You added it. */
  mine: boolean;
  /** You added it, or you are an admin. */
  canDelete: boolean;
  /** The shared sync nudge, in milliseconds (positive: the tab runs ahead). */
  offsetMs: number;
  /** Display name of whoever added it; null when unknown. */
  addedBy: string | null;
  downloadUrl: string;
  /** Set for a tab found online (kind fetched). */
  source?: TabOnlineSource | null;
  /** Where the tab sits in the recording (align.py), when it has been
   *  lined up; drawn by it only when confident (lib/tabSync.ts isLinedUp). */
  timing?: TabTiming | null;
}

/** Every tab the page can draw for a track: files, then pasted text tabs,
 *  then tabs found online. Anything else (a generated tab from an older
 *  server, still in a cached answer) is left out. */
export function drawableTabs(tabs: TabSummary[]): TabSummary[] {
  return DRAWN_KINDS.flatMap((kind) => tabs.filter((t) => t.kind === kind));
}

function addedByLabel(tab: TabSummary): string {
  return tab.mine ? 'you' : (tab.addedBy ?? 'someone');
}

/** "Ultimate Guitar, ver 2, bass": the site, then what tells this tab
 *  apart from the site's others. */
function onlineName(source: TabOnlineSource): string {
  const parts = [source.siteLabel];
  if (source.version > 1) parts.push(`ver ${source.version}`);
  if (source.part === 'bass') parts.push('bass');
  return parts.join(', ');
}

/** "★ 4.7 (1,371 votes)", or '' when the site gave no rating. */
export function ratingLabel(source: TabOnlineSource): string {
  if (source.rating === null || !(source.rating > 0)) return '';
  const votes = source.votes ?? 0;
  return `★ ${source.rating.toFixed(1)} (${votes.toLocaleString('en-US')} vote${votes === 1 ? '' : 's'})`;
}

/** A tab found online that align.py has not lined up with the recording
 *  (or not confidently) starts at the song's
 *  start plus the nudge, at the tab's own tempo. Said calmly on the chip. */
export const NOT_LINED_UP = 'not lined up yet';
export const LINED_UP = 'lined up';

/** The chip under the title: where the notes came from. `instrument` is
 *  the staff shown, named for a Songsterr tab (it holds several). */
export function sourceChipLabel(tab: TabSummary, instrument?: string): string {
  if (tab.kind === 'fetched' && tab.source) {
    const shown = tab.source.site === 'songsterr' && instrument ? `, ${instrument}` : '';
    return `From ${onlineName(tab.source)}${shown}, ${isLinedUp(tab.timing) ? LINED_UP : NOT_LINED_UP}`;
  }
  const scope = tab.shared ? 'shared' : 'private';
  if (tab.kind === 'pasted') return `Text tab pasted by ${addedByLabel(tab)}, ${scope}`;
  return `File added by ${addedByLabel(tab)}, ${scope}`;
}

/** What the page shows when there is no tab to draw (the tab page's
 *  "Songsterr list" empty state):
 *
 *   - `searching`: the store, Songsterr or the online search is still
 *     answering ("Looking on Songsterr…");
 *   - `matches`: Songsterr has the song, but Ember could not draw its tab,
 *     so the versions open on Songsterr;
 *   - `none`: nothing on Songsterr, so the places people post tabs. */
export type EmptyState =
  | { kind: 'searching' }
  | { kind: 'matches'; matches: TabMatch[] }
  | { kind: 'none' };

export function emptyStateFor(input: {
  /** The store has not answered yet. */
  loading: boolean;
  /** The online search for this song is running. */
  searchingOnline: boolean;
  /** Songsterr has not answered yet. */
  matchesLoading: boolean;
  matches: TabMatch[];
}): EmptyState {
  if (input.loading || input.searchingOnline || input.matchesLoading) return { kind: 'searching' };
  if (input.matches.length > 0) return { kind: 'matches', matches: input.matches };
  return { kind: 'none' };
}

// ── routes ────────────────────────────────────────────────────────────────

/** The tab page for a track: `/tabs/youtube%3Aabc`. */
export function tabsHref(trackId: string): string {
  return `/tabs/${encodeURIComponent(trackId)}`;
}

/** The track id back out of the route segment. Next may hand it over still
 *  encoded; a malformed escape is used as it is. */
export function trackIdFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

/** While a tab page follows the playing song and the player moves on to the
 *  next one, the page moves with it (the old dialog did the same: a tab
 *  for the previous song must not stay up over the new one). Returns the
 *  route to go to, or null to stay. A page opened for a song that was not
 *  playing stays put. */
export function followTrackChange(pageId: string, prevCurrentId: string | null, currentId: string | null): string | null {
  if (!currentId || !prevCurrentId || prevCurrentId === currentId) return null;
  if (pageId !== prevCurrentId) return null;
  return tabsHref(currentId);
}

/** Is `pathname` the tab page for this track? Paths may arrive encoded
 *  (`upload%3Aabc`) or not. */
export function isTabsPathFor(pathname: string | null, trackId: string): boolean {
  if (!pathname?.startsWith('/tabs/')) return false;
  return trackIdFromParam(pathname.slice('/tabs/'.length)) === trackId;
}
