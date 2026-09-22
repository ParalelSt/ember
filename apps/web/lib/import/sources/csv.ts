/** Any CSV with a header row: Exportify, Soundiiz, TuneMyMusic,
 *  spotify-backup, Apple's "Likes and Dislikes", a spreadsheet someone
 *  typed by hand.
 *
 *  There is no standard export format, so the header row is sniffed rather
 *  than assumed: each column name is lower-cased and matched against a list
 *  of aliases. A file whose header names no title column is refused with its
 *  own header quoted back, which is the one thing that tells the person what
 *  Ember was looking at.
 *
 *  The reader itself is RFC 4180 by hand (no new dependency): quoted fields,
 *  doubled quotes inside them, commas and newlines inside quotes, CR LF or
 *  LF line ends. A BOM is stripped by the caller (index.ts). Pure. */

import { field, type ParseError, type ParsedSource, type TransferItem } from '@/lib/import/sources/types';
import type { SourceOrder } from '@/lib/import/likedAt';

/** Stop reading a file this long: past it, it is not a song list. */
export const MAX_CSV_ROWS = 50_000;

/** Header names, lower-cased, per column Ember can use. */
const ALIASES = {
  title: ['track name', 'name', 'title', 'song', 'song name', 'track', 'track title'],
  artists: ['artist name(s)', 'artist', 'artists', 'artist name', 'artist names', 'album artist'],
  album: ['album name', 'album'],
  duration: ['track duration (ms)', 'duration (ms)', 'duration_ms', 'duration ms', 'track duration', 'duration', 'time', 'length'],
  added: ['added at', 'added_at', 'date added', 'added', 'liked at', 'last modified', 'date'],
  uri: ['track uri', 'uri', 'spotify uri', 'url', 'spotify track id', 'track id'],
  /** Apple's export: "Artist - Title" in one column, LOVE or DISLIKE beside it. */
  description: ['item description'],
  preference: ['preference'],
} as const;

type Column = keyof typeof ALIASES;

/** The delimiter a file uses. Tabs and semicolons are common in exports made
 *  in a locale where the comma is a decimal point. */
function sniffDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 1 ? best[0] : ',';
}

/** One CSV file to rows of fields. */
export function readCsv(text: string, delimiter: string, maxRows = MAX_CSV_ROWS): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
    // The next field starts fresh, so its own opening quote counts.
    started = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    started = false;
  };
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is one quote.
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && !started) {
      quoted = true;
      started = true;
    } else if (c === delimiter) endCell();
    else if (c === '\r') continue;
    else if (c === '\n') endRow();
    else {
      cell += c;
      started = true;
    }
  }
  if (cell || row.length) endRow();
  return rows;
}

/** Which of Ember's columns each position of the header row holds. */
function mapHeader(header: string[]): Partial<Record<Column, number>> {
  const out: Partial<Record<Column, number>> = {};
  header.forEach((raw, i) => {
    const name = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [column, names] of Object.entries(ALIASES) as [Column, readonly string[]][]) {
      if (out[column] === undefined && names.includes(name)) out[column] = i;
    }
  });
  return out;
}

/** "3:45", "225000" (ms), "225" (seconds) to milliseconds. */
function readDuration(raw: string, headerName: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const clock = /^(\d+):([0-5]\d)$/.exec(value);
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Only the header says which unit a bare number is in, and a song is never
  // 200 000 seconds long either way.
  return /ms/.test(headerName) || n > 10_000 ? Math.round(n) : Math.round(n * 1000);
}

function readDate(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** "A, B" or "A; B" to ["A", "B"].
 *
 *  No exporter marks where one artist ends and the next begins, and a band
 *  can have a comma in its own name ("Earth, Wind & Fire"), so this split is
 *  a guess and sometimes a wrong one. That is why the whole line is kept as
 *  `artist` beside the list: lib/import/score.ts scores against both, so a
 *  wrongly split band still matches on its full name. */
function splitArtists(raw: string): string[] {
  return raw
    .split(/\s*[;]\s*|,\s+/)
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** Apple writes "Artist - Title" into one column. */
function splitDescription(raw: string): { artist: string; title: string } {
  const m = /^(.*?)\s+-\s+(.*)$/.exec(raw.trim());
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: raw.trim() };
}

export interface CsvResult extends Omit<ParsedSource, 'label'> {
  /** True when the file is Apple's likes export rather than a plain CSV. */
  apple: boolean;
  /** Every `uri` value seen started with `spotify:`, which names the source. */
  fromSpotify: boolean;
}

/** Read a whole CSV into source songs. Rows without a title are counted as
 *  dropped; a file with no title column at all is an error the person can
 *  act on. */
export function parseCsv(text: string): CsvResult | ParseError {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delimiter = sniffDelimiter(firstLine);
  const rows = readCsv(text, delimiter);
  const header = rows.shift();
  if (!header || !header.length) return { error: 'That file is empty.' };
  const at = mapHeader(header);
  const apple = at.description !== undefined && at.preference !== undefined;
  if (at.title === undefined && !apple) {
    return {
      error: `Ember could not find a song column in that file. Its first line reads: ${firstLine.trim().slice(0, 200)}`,
    };
  }

  const items: TransferItem[] = [];
  let dropped = 0;
  const dates: number[] = [];
  let uris = 0;
  let spotifyUris = 0;

  for (const row of rows) {
    if (!row.length || row.every((c) => !c.trim())) continue;
    const cell = (i: number | undefined) => (i === undefined ? '' : field(row[i] ?? ''));

    // Apple keeps only what the person loved; the dislikes are theirs to
    // keep, not something to bring over.
    if (apple && cell(at.preference).toUpperCase() !== 'LOVE') {
      dropped++;
      continue;
    }

    const described = apple ? splitDescription(cell(at.description)) : null;
    const title = described ? described.title : cell(at.title);
    if (!title) {
      dropped++;
      continue;
    }
    const artistLine = described ? described.artist : cell(at.artists);
    const uri = cell(at.uri).slice(0, 200);
    if (uri) {
      uris++;
      if (uri.startsWith('spotify:')) spotifyUris++;
    }
    const likedAt = readDate(cell(at.added));
    if (likedAt !== null) dates.push(likedAt);

    items.push({
      position: items.length,
      title,
      artists: splitArtists(artistLine),
      artist: artistLine,
      durationMs: at.duration === undefined ? null : readDuration(cell(at.duration), header[at.duration].toLowerCase()),
      explicit: null,
      uri: uri || null,
      likedAt,
    });
  }

  return {
    kind: apple ? 'apple-export' : 'csv',
    order: orderOf(dates, items.length),
    items,
    dropped,
    // The reader stopped before the end of the file.
    truncated: rows.length + 1 >= MAX_CSV_ROWS,
    apple,
    fromSpotify: uris > 0 && uris === spotifyUris,
  };
}

/** Which way round the file lists its songs, from the dates it carries.
 *  Anything but a clean run in one direction is `unknown`, which is treated
 *  as newest-first. */
function orderOf(dates: number[], total: number): SourceOrder {
  if (dates.length < 2 || dates.length < total) return 'unknown';
  let up = true;
  let down = true;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] < dates[i - 1]) up = false;
    if (dates[i] > dates[i - 1]) down = false;
  }
  if (up && !down) return 'oldest-first';
  if (down && !up) return 'newest-first';
  return 'unknown';
}
