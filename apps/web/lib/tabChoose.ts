/** Choosing a tab, instrument first (the owner's pick): what you play, then
 *  which version of it. Most songs have one tab per instrument and a few
 *  versions of each, so asking the instrument first keeps the list short
 *  and puts the best match on top. Pure: the page feeds it the store's
 *  rows and the instruments of the score on screen. */

import { instrumentsOf, sheetRows, type SheetRowsOptions, type TabSheetRow } from '@/lib/tabPick';
import type { TabSummary } from '@/lib/tabSources';

/** What a tab with no word on its instruments is taken to hold. */
export const DEFAULT_PART = 'Guitar';

/** One tile of the instrument step. */
export interface InstrumentChoice {
  /** As the first tab that holds it names it ("Rhythm Guitar"), with a
   *  capital first letter. */
  name: string;
  /** For matching across tabs: lower case, trimmed. */
  key: string;
  /** How many of the song's tabs hold it. */
  count: number;
}

/** One version of the chosen instrument, as the list draws it. */
export interface VersionChoice extends TabSheetRow {
  /** 1 for the best match. */
  rank: number;
  /** Which of the tab's tracks is this instrument. */
  track: number;
  /** "Songsterr", "Ultimate Guitar", "File", "Text tab". */
  source: string;
}

/** The score on screen and the names its tracks have (truer than what the
 *  site said, and in the file's own order). */
export interface DrawnParts {
  tabId: string;
  tracks: string[];
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function instrumentKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The parts a tab holds, in track order: the drawn score's own tracks,
 *  else what its source said, else one guitar part. */
export function tabParts(tab: TabSummary, drawn?: DrawnParts | null): string[] {
  if (drawn && drawn.tabId === tab.id && drawn.tracks.length > 0) return drawn.tracks;
  const named = instrumentsOf(tab).filter((n) => n.trim());
  return named.length > 0 ? named : [DEFAULT_PART];
}

/** Where a tab is from, in a word or two. */
export function sourceName(tab: TabSummary): string {
  if (tab.kind === 'fetched') return tab.source?.siteLabel ?? 'Found online';
  return tab.kind === 'pasted' ? 'Text tab' : 'File';
}

/** Every instrument the song's tabs hold, in the order the best tabs hold
 *  them, with how many tabs hold each. */
export function instrumentChoices(tabs: TabSummary[], drawn?: DrawnParts | null, o: SheetRowsOptions = {}): InstrumentChoice[] {
  const out: InstrumentChoice[] = [];
  const byId = new Map(tabs.map((t) => [t.id, t]));
  for (const row of sheetRows(tabs, o)) {
    const tab = byId.get(row.id);
    if (!tab) continue;
    const seen = new Set<string>();
    for (const name of tabParts(tab, drawn)) {
      const key = instrumentKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      const known = out.find((c) => c.key === key);
      if (known) known.count++;
      else out.push({ name: capitalized(name.trim()), key, count: 1 });
    }
  }
  return out;
}

/** The versions of one instrument, best match first: the ones lined up
 *  with the recording by how sure the alignment is, then the rest in the
 *  order Ember ranks them (lib/tabPick.ts). */
export function versionsFor(
  tabs: TabSummary[],
  instrument: string,
  drawn?: DrawnParts | null,
  o: SheetRowsOptions = {},
): VersionChoice[] {
  const key = instrumentKey(instrument);
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const rows = sheetRows(tabs, o).flatMap((row, order) => {
    const tab = byId.get(row.id);
    if (!tab) return [];
    const track = tabParts(tab, drawn).findIndex((n) => instrumentKey(n) === key);
    return track < 0 ? [] : [{ row, order, track, source: sourceName(tab) }];
  });
  rows.sort((a, b) => {
    const la = a.row.linedUp ? (a.row.confidence ?? 0) : -1;
    const lb = b.row.linedUp ? (b.row.confidence ?? 0) : -1;
    return lb - la || a.order - b.order;
  });
  return rows.map((r, i) => ({ ...r.row, rank: i + 1, track: r.track, source: r.source }));
}

/** The version button: "Songsterr · 1 of 3". */
export function versionLabel(versions: VersionChoice[], tab: TabSummary): string {
  const at = versions.find((v) => v.id === tab.id);
  return at ? `${at.source} · ${at.rank} of ${versions.length}` : sourceName(tab);
}
