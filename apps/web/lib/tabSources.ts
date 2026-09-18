import type { TabMatch } from '@/lib/songsterr';

/** The tab store's shapes and the source chain, without the server: the
 *  routes (lib/tabStore.ts) build these, the tab page (/tabs/[trackId])
 *  picks from them. docs/tabs-rebuild.md section 3. */

export type TabKind = 'file' | 'generated';

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
  /** Display name of whoever added it; null when unknown (a generated tab
   *  recorded after the fact names nobody). */
  addedBy: string | null;
  downloadUrl: string;
}

export type TabSource =
  | { type: 'file'; tab: TabSummary }
  | { type: 'generated'; tab: TabSummary }
  | { type: 'songsterr'; match: TabMatch };

/** The source chain for a track, in the order the viewer tries them: a file
 *  someone added, then a generated tab, then Songsterr's link-out. */
export function orderSources(tabs: TabSummary[], matches: TabMatch[]): TabSource[] {
  return [
    ...tabs.filter((t) => t.kind === 'file').map((tab) => ({ type: 'file' as const, tab })),
    ...tabs.filter((t) => t.kind === 'generated').map((tab) => ({ type: 'generated' as const, tab })),
    ...matches.map((match) => ({ type: 'songsterr' as const, match })),
  ];
}

/** Where the generated tab for this track stands (GET /api/tabs/generated). */
export type GeneratedStatus = 'ready' | 'running' | 'failed' | 'none';

/** The generated tab of the track itself when its file exists but no row
 *  was found yet (a tab generated before the store; the GET that serves it
 *  writes the row). Keeps the chain honest without waiting for a refetch. */
export function generatedStandIn(trackId: string, title: string, artist: string): TabSummary {
  return {
    id: `generated:${trackId}`,
    kind: 'generated',
    title,
    artist,
    instrument: 'Guitar',
    trackId,
    ext: '.alphatex',
    format: 'alphatex',
    shared: true,
    mine: false,
    canDelete: false,
    offsetMs: 0,
    addedBy: null,
    downloadUrl: `/api/tabs/generated/${encodeURIComponent(trackId)}`,
  };
}

/** Every tab the page can draw for a track, file first. A generated tab
 *  that is ready on disk but has no row yet is added as a stand-in. */
export function drawableTabs(
  tabs: TabSummary[],
  generated: GeneratedStatus,
  track: { id: string; title: string; artist: string },
): TabSummary[] {
  const files = tabs.filter((t) => t.kind === 'file');
  const gens = tabs.filter((t) => t.kind === 'generated');
  // The track's own generated tab first among generated ones: it was made
  // from this very recording, so it lines up best.
  gens.sort((a, b) => Number(b.trackId === track.id) - Number(a.trackId === track.id));
  if (generated === 'ready' && !gens.some((t) => t.trackId === track.id)) {
    gens.unshift(generatedStandIn(track.id, track.title, track.artist));
  }
  return [...files, ...gens];
}

/** The tab to show: the one the listener picked if it still exists, else
 *  the first in the chain. Null when there is nothing to draw. */
export function pickTab(tabs: TabSummary[], chosenId: string | null): TabSummary | null {
  return tabs.find((t) => t.id === chosenId) ?? tabs[0] ?? null;
}

/** The key a listener's own sync nudge is kept under on this device. A
 *  generated tab is keyed by its track, as the old viewer did, so a nudge
 *  survives the tab getting its row. */
export function localOffsetId(tab: TabSummary): string {
  return tab.kind === 'generated' && tab.trackId ? `generated:${tab.trackId}` : tab.id;
}

/** The chip under the title: where the notes came from. */
export function sourceChipLabel(tab: TabSummary): string {
  if (tab.kind === 'generated') return 'Generated from the recording';
  const who = tab.mine ? 'you' : (tab.addedBy ?? 'someone');
  return `File added by ${who}, ${tab.shared ? 'shared' : 'private'}`;
}

/** What the page shows when there is no tab to draw. */
export type EmptyState =
  | { kind: 'loading' }
  | { kind: 'generating' }
  | {
      kind: 'empty';
      /** "Generate a tab" is offered (YouTube and uploaded songs). */
      canGenerate: boolean;
      /** The last generation failed, with its reason. */
      failed: string | null;
      /** Songsterr has this song: link out, since that is all there is. */
      songsterr: TabMatch[];
    };

export function emptyStateFor(input: {
  loading: boolean;
  generated: GeneratedStatus;
  generating: boolean;
  generateError: string | null;
  canGenerate: boolean;
  matches: TabMatch[];
}): EmptyState {
  if (input.loading) return { kind: 'loading' };
  if (input.generated === 'running' || input.generating) return { kind: 'generating' };
  return {
    kind: 'empty',
    canGenerate: input.canGenerate,
    failed: input.generated === 'failed' ? (input.generateError ?? 'The last attempt failed.') : null,
    songsterr: input.matches,
  };
}

/** Tabs can be generated from recordings Ember has: YouTube and uploads. */
export function canGenerateFor(trackId: string): boolean {
  return /^(youtube|upload):/.test(trackId);
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
