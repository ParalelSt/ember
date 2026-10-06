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
  /** "Rhythm guitar", "Bass" (partName). */
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

/** The score on screen and its tracks (truer than what the site said, and
 *  in the file's own order): each track's name and its instrument (the
 *  General MIDI program's name, "Clean guitar"). */
export interface DrawnParts {
  tabId: string;
  tracks: { name: string; instrument?: string }[];
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a track is, said the same way whoever named it: files, Songsterr
 *  and the drawn score all name parts their own way ("Gtr", "Rhythm
 *  Guitar", "Distortion guitar", "Track 1"). Null when the name says
 *  nothing known. */
export function partFamily(raw: string): string | null {
  const n = raw.toLowerCase();
  if (/drum|percussion/.test(n)) return 'Drums';
  if (/bass/.test(n)) return 'Bass';
  if (/guitar|gtr|\bgt\b/.test(n)) {
    if (/lead|solo/.test(n)) return 'Lead guitar';
    if (/rhythm/.test(n)) return 'Rhythm guitar';
    if (/acoustic|nylon|steel|classical/.test(n)) return 'Acoustic guitar';
    return 'Guitar';
  }
  if (/vocal|voice|vox|sing/.test(n)) return 'Vocals';
  if (/piano|keys|keyboard|synth|organ/.test(n)) return 'Keys';
  return null;
}

/** A part's name for the tiles: its family by its name, else by its
 *  instrument, else the name as given. The instrument (a General MIDI
 *  program, which files often leave at a default) only says guitar, bass
 *  or drums; lead, rhythm or acoustic come from the name alone ("Lead"
 *  playing a guitar is the lead guitar). */
export function partName(name: string, instrument?: string): string {
  const byName = partFamily(name);
  if (byName) return byName;
  const family = instrument ? partFamily(instrument) : null;
  if (family && /guitar/i.test(family)) return partFamily(`${name} guitar`) ?? 'Guitar';
  return family ?? capitalized(name.trim() || DEFAULT_PART);
}

export function instrumentKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Two parts of one tab with the same name are told apart: "Guitar",
 *  "Guitar 2". */
function numbered(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = instrumentKey(n);
    const count = (seen.get(k) ?? 0) + 1;
    seen.set(k, count);
    return count > 1 ? `${n} ${count}` : n;
  });
}

/** The parts a tab holds, in track order: the drawn score's own tracks,
 *  else what its source said, else one guitar part. */
export function tabParts(tab: TabSummary, drawn?: DrawnParts | null): string[] {
  if (drawn && drawn.tabId === tab.id && drawn.tracks.length > 0) {
    return numbered(drawn.tracks.map((t) => partName(t.name, t.instrument)));
  }
  const named = instrumentsOf(tab).filter((n) => n.trim());
  return named.length > 0 ? numbered(named.map((n) => partName(n))) : [DEFAULT_PART];
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
    for (const name of tabParts(tab, drawn)) {
      const key = instrumentKey(name);
      const known = out.find((c) => c.key === key);
      if (known) known.count++;
      else out.push({ name, key, count: 1 });
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
