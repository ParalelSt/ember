import { isLinedUp } from '@/lib/tabSync';
import { ratingLabel, type TabSummary } from '@/lib/tabSources';

/** Which of a song's tabs Ember draws, and the rows the Source sheet lists
 *  (docs/tabs-v3.md stages 6 and 7).
 *
 *  The rule, in one sentence: the tab that matches the recording best wins,
 *  and when two match about equally well the better source wins.
 *
 *   1. A tab the listener picked themselves always wins, for as long as it
 *      exists (TabsPage remembers the pick per song).
 *   2. Otherwise: the best alignment confidence align.py found; every tab
 *      within MIN_SCORE_GAP of it counts as matching just as well, and
 *      among those the source rank decides (a file someone chose for this
 *      song, then Songsterr's notes, then Ultimate Guitar's text, then a
 *      pasted tab, then the generated one).
 *
 *  The gap is what stops a re-alignment that scores a point better from
 *  flipping the choice from one run to the next.
 *
 *  Everything here is pure: the page feeds it the rows the store returned. */

/** The order Ember trusts sources in when they match the recording equally
 *  well. Lower is better. */
export function sourceRank(tab: TabSummary): number {
  if (tab.kind === 'file') return 0;
  if (tab.kind === 'fetched') return tab.source?.site === 'songsterr' ? 1 : 2;
  if (tab.kind === 'pasted') return 3;
  return 4;
}

/** How well this tab matched the recording, 0 to 1. A tab align.py could
 *  not place confidently scores 0: it is drawn from the top, so its number
 *  says nothing about where the tab sits. */
export function matchScore(tab: TabSummary): number {
  return isLinedUp(tab.timing) ? tab.timing.confidence : 0;
}

/** How much better a worse-ranked tab has to match before it takes the
 *  drawn tab's place. Five points of confidence. */
export const MIN_SCORE_GAP = 0.05;

/** "Lined up 94%". */
export function confidencePercent(tab: TabSummary): number | null {
  const c = tab.timing?.confidence;
  return typeof c === 'number' && Number.isFinite(c) ? Math.round(c * 100) : null;
}

/** Every tab for the song, best first: the ones matching the recording as
 *  well as the best one (within the gap) come first in source order, then
 *  the rest by how well they matched. The first is the one Ember draws. */
export function rankTabs(tabs: TabSummary[]): TabSummary[] {
  const best = tabs.reduce((m, t) => Math.max(m, matchScore(t)), 0);
  const near = (t: TabSummary) => matchScore(t) >= best - MIN_SCORE_GAP;
  const index = new Map(tabs.map((t, i) => [t.id, i]));
  return [...tabs].sort((a, b) => {
    if (near(a) !== near(b)) return near(a) ? -1 : 1;
    if (near(a)) return sourceRank(a) - sourceRank(b) || index.get(a.id)! - index.get(b.id)!;
    return matchScore(b) - matchScore(a) || sourceRank(a) - sourceRank(b) || index.get(a.id)! - index.get(b.id)!;
  });
}

export interface TabChoice {
  /** The tab to draw; null when the song has none. */
  tab: TabSummary | null;
  /** Why this one, in a few words: "best match, lined up 94%". */
  reason: string;
  /** The listener picked it themselves. */
  byUser: boolean;
}

/** The tab to draw, and why. `chosenId` is the listener's own pick for this
 *  song; it wins whenever it is still there. */
export function chooseTab(tabs: TabSummary[], chosenId: string | null): TabChoice {
  const ordered = rankTabs(tabs);
  const picked = chosenId ? ordered.find((t) => t.id === chosenId) : undefined;
  if (picked) return { tab: picked, reason: 'your pick', byUser: true };
  const tab = ordered[0] ?? null;
  if (!tab) return { tab: null, reason: '', byUser: false };
  if (ordered.length < 2) return { tab, reason: 'the only tab for this song', byUser: false };
  const pct = confidencePercent(tab);
  if (matchScore(tab) > 0 && pct !== null) return { tab, reason: `best match, lined up ${pct}%`, byUser: false };
  return { tab, reason: 'the best source for this song, not lined up yet', byUser: false };
}

// ── the Source sheet's rows ───────────────────────────────────────────────

/** Which heading a tab sits under in the sheet. */
export type TabSheetGroup = 'songsterr' | 'ug' | 'server';

export const GROUP_LABELS: Record<TabSheetGroup, string> = {
  songsterr: 'Songsterr',
  ug: 'Ultimate Guitar',
  server: 'On this server',
};

export const BEST_BADGE = 'Best match';
export const PICK_BADGE = 'Your pick';

/** One line of the Source sheet: everything the sheet draws, worked out
 *  here so the sheet itself stays presentational. */
export interface TabSheetRow {
  id: string;
  group: TabSheetGroup;
  groupLabel: string;
  /** "Tab with rhythm", "Text tab", "Guitar Pro file", "Generated, rough". */
  type: string;
  /** What tells this tab from the song's others. */
  name: string;
  /** "★ 4.7 (512 votes)", or '' when the site gave none. */
  rating: string;
  instruments: string[];
  /** align.py's confidence as a percentage, or null when never tried. */
  confidence: number | null;
  linedUp: boolean;
  /** "Lined up 94%", "Not lined up yet" or "Lining it up…". */
  status: string;
  /** "Best match", "Your pick", or null. */
  badge: string | null;
  /** "added by Mira", "pasted by you"; null for a tab found online. */
  addedBy: string | null;
  /** This is the tab on screen. */
  drawn: boolean;
  canDelete: boolean;
  canLineUp: boolean;
  aligning: boolean;
}

/** A generated tab that has no row yet (lib/tabSources.ts generatedStandIn)
 *  cannot be deleted or lined up: there is nothing on the server to name. */
const isStandIn = (tab: TabSummary) => tab.id.startsWith('generated:');

function groupOf(tab: TabSummary): TabSheetGroup {
  if (tab.kind !== 'fetched') return 'server';
  return tab.source?.site === 'songsterr' ? 'songsterr' : 'ug';
}

/** "Tab with rhythm", "Bass tab", "MusicXML file"... */
export function tabTypeLabel(tab: TabSummary): string {
  if (tab.kind === 'generated') return 'Generated, rough';
  if (tab.kind === 'pasted') return 'Pasted text tab';
  if (tab.kind === 'fetched') {
    if (tab.source?.site === 'songsterr') return 'Tab with rhythm';
    return tab.source?.part === 'bass' ? 'Bass tab' : 'Text tab';
  }
  return tab.format === 'musicxml' || tab.format === 'mxl' ? 'MusicXML file' : 'Guitar Pro file';
}

function nameOf(tab: TabSummary): string {
  if (tab.kind === 'generated') return 'Generated from the recording';
  const version = tab.kind === 'fetched' ? (tab.source?.version ?? 1) : 1;
  return version > 1 ? `${tab.title} (ver ${version})` : tab.title;
}

function instrumentsOf(tab: TabSummary): string[] {
  if (tab.kind === 'fetched' && tab.source?.site === 'songsterr') return tab.source.instruments ?? [];
  if (tab.kind === 'fetched') return [tab.source?.part === 'bass' ? 'Bass' : 'Guitar'];
  return tab.instrument ? [tab.instrument] : [];
}

function addedByOf(tab: TabSummary): string | null {
  if (tab.kind === 'fetched' || tab.kind === 'generated') return null;
  const who = tab.mine ? 'you' : (tab.addedBy ?? 'someone');
  return `${tab.kind === 'pasted' ? 'pasted' : 'added'} by ${who}`;
}

/** "Lined up 94%", "Not lined up yet", or "Lining it up…" while a job runs. */
export function statusLabel(tab: TabSummary, aligning = false): string {
  if (aligning) return 'Lining it up…';
  if (!isLinedUp(tab.timing)) return 'Not lined up yet';
  return `Lined up ${confidencePercent(tab)}%`;
}

export interface SheetRowsOptions {
  /** The listener's own pick for this song, if they made one. */
  chosenId?: string | null;
  /** Tabs with a "Line it up" job running now. */
  aligning?: readonly string[];
}

/** Every tab for the song as the sheet lists it, best first, with the
 *  reason the drawn one is drawn on its row. */
export function sheetRows(tabs: TabSummary[], o: SheetRowsOptions = {}): TabSheetRow[] {
  const ordered = rankTabs(tabs);
  const choice = chooseTab(tabs, o.chosenId ?? null);
  const aligning = new Set(o.aligning ?? []);
  return ordered.map((tab) => {
    const group = groupOf(tab);
    const busy = aligning.has(tab.id);
    return {
      id: tab.id,
      group,
      groupLabel: GROUP_LABELS[group],
      type: tabTypeLabel(tab),
      name: nameOf(tab),
      rating: tab.source ? ratingLabel(tab.source) : '',
      instruments: instrumentsOf(tab),
      confidence: confidencePercent(tab),
      linedUp: isLinedUp(tab.timing),
      status: statusLabel(tab, busy),
      badge: choice.tab?.id === tab.id ? (choice.byUser ? PICK_BADGE : ordered.length > 1 ? BEST_BADGE : null) : null,
      addedBy: addedByOf(tab),
      drawn: choice.tab?.id === tab.id,
      canDelete: tab.canDelete && !isStandIn(tab),
      canLineUp: !isStandIn(tab),
      aligning: busy,
    };
  });
}

/** The sheet's rows under their headings, in the order the rows came in
 *  (so the group holding the best tab comes first). */
export function groupRows(rows: TabSheetRow[]): { group: TabSheetGroup; label: string; rows: TabSheetRow[] }[] {
  const out: { group: TabSheetGroup; label: string; rows: TabSheetRow[] }[] = [];
  for (const row of rows) {
    const last = out.find((g) => g.group === row.group);
    if (last) last.rows.push(row);
    else out.push({ group: row.group, label: row.groupLabel, rows: [row] });
  }
  return out;
}

// ── the listener's own pick ───────────────────────────────────────────────

/** Where a listener's pick for a song is kept: this browser, keyed by the
 *  track. It is a per-listener taste (the tab page already remembers the
 *  staff, the scroll and the instrument the same way), so one member's
 *  choice never changes what the rest of the server sees, and it needs no
 *  new collection. */
export const pickKey = (trackId: string) => `ember.tab.pick.${trackId}`;

export function loadPick(trackId: string): string | null {
  try {
    return window.localStorage.getItem(pickKey(trackId)) || null;
  } catch {
    return null;
  }
}

export function savePick(trackId: string, tabId: string | null): void {
  try {
    if (tabId) window.localStorage.setItem(pickKey(trackId), tabId);
    else window.localStorage.removeItem(pickKey(trackId));
  } catch {
    // A pick that cannot be remembered is not worth an error.
  }
}
