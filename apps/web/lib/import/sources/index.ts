/** One door for every uploaded or pasted transfer source.
 *
 *  What arrives is a file nobody checked or a box someone pasted into, so
 *  the shape is worked out from the content rather than trusted from the
 *  name: a zip is turned away with a sentence that says what to do instead,
 *  UTF-16 is turned away because a silent mojibake import is worse than a
 *  refusal, JSON goes to the Spotify export reader, a header row goes to the
 *  CSV sniffer and anything else is read as pasted lines.
 *
 *  Caps live here, not in the parsers: 20 MB of file, 10 000 songs per
 *  transfer, and the per-parser row limits. Pure: no network, no disk, no
 *  PocketBase. */

import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { parseCsv } from '@/lib/import/sources/csv';
import { dedupeItems } from '@/lib/import/sources/dedupe';
import { parsePaste } from '@/lib/import/sources/paste';
import { parseSpotifyExport } from '@/lib/import/sources/spotifyExport';
import { isParseError, type ParseError, type ParsedSource } from '@/lib/import/sources/types';

/** Most an upload may weigh. A 10 000-song Exportify CSV is about 2 MB, so
 *  this is generous and still far below what would hurt the host. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const TOO_LARGE_MESSAGE = 'That file is over 20 MB. Ember reads song lists, not whole libraries of audio.';
export const ZIP_MESSAGE =
  'That is a zip. Unzip it and upload the YourLibrary.json inside (Spotify puts it in the my_spotify_data folder).';
export const UTF16_MESSAGE =
  'Ember could not read that file: it is saved as UTF-16. Save it again as UTF-8 (or as CSV UTF-8 from a spreadsheet) and upload it once more.';

export interface TransferInput {
  /** Only used to tell a .csv apart from a pasted list. Never trusted for
   *  what the file actually holds. */
  filename?: string;
  bytes?: Uint8Array;
  text?: string;
}

/** Is this more bytes than a song list could possibly be? Routes call it
 *  before they buffer, on `content-length`, and again on what arrived. */
export function tooLarge(bytes: number): boolean {
  return bytes > MAX_UPLOAD_BYTES;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** Bytes to text, or a sentence saying why not. */
export function decodeText(bytes: Uint8Array): string | ParseError {
  if (tooLarge(bytes.length)) return { error: TOO_LARGE_MESSAGE };
  if (ZIP_MAGIC.every((b, i) => bytes[i] === b)) return { error: ZIP_MESSAGE };
  // UTF-16 by its mark, or by the NUL bytes a UTF-16 file is full of. A
  // NUL is legal UTF-8, so a decoder alone would let it through as
  // gibberish.
  const bom16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  const nul = bytes.subarray(0, 4096).includes(0);
  if (bom16 || nul) return { error: UTF16_MESSAGE };
  // A UTF-8 mark is what a spreadsheet writes; everything after it is text.
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return { error: 'Ember could not read that file as text. Save it as UTF-8 and try again.' };
  }
}

/** Does the first line read as a header row Ember knows? */
function looksLikeCsv(text: string, filename?: string): boolean {
  if (/\.(csv|tsv)$/i.test(filename ?? '')) return true;
  const firstLine = text.split('\n', 1)[0] ?? '';
  if (!/[,;\t]/.test(firstLine)) return false;
  // A pasted list can hold commas ("Earth, Wind & Fire - September"), so a
  // delimiter alone is not enough: the line has to name a column Ember uses.
  return /\b(track name|artist name|album name|track uri|item description|added at|title|song)\b/i.test(firstLine);
}

/** Read whatever arrived into a list of source songs. */
export function parseTransferInput(input: TransferInput): ParsedSource | ParseError {
  let text = input.text;
  if (text === undefined) {
    if (!input.bytes) return { error: 'There was nothing to read. Choose a file or paste your songs.' };
    const decoded = decodeText(input.bytes);
    if (typeof decoded !== 'string') return decoded;
    text = decoded;
  } else if (tooLarge(Buffer.byteLength(text, 'utf8'))) {
    return { error: TOO_LARGE_MESSAGE };
  }
  if (!text.trim()) return { error: 'There was nothing to read. Choose a file or paste your songs.' };

  const parsed = parseOne(text, input.filename);
  if (isParseError(parsed)) return parsed;

  const deduped = dedupeItems(parsed.items);
  const overCap = deduped.items.length > MAX_TRANSFER_ITEMS;
  return {
    ...parsed,
    items: overCap ? deduped.items.slice(0, MAX_TRANSFER_ITEMS) : deduped.items,
    dropped: parsed.dropped + deduped.dropped,
    // Either the whole list was longer than a transfer may carry, or the
    // parser stopped reading before it got to the end.
    truncated: overCap || parsed.truncated,
  };
}

function parseOne(text: string, filename?: string): ParsedSource | ParseError {
  if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { error: 'That file starts like JSON but Ember could not read it. Upload YourLibrary.json as Spotify sent it.' };
    }
    return parseSpotifyExport(json);
  }

  if (looksLikeCsv(text, filename)) {
    const csv = parseCsv(text);
    if (isParseError(csv)) return csv;
    return {
      kind: csv.kind,
      label: csvLabel(csv.kind, csv.fromSpotify),
      order: csv.order,
      items: csv.items,
      dropped: csv.dropped,
      truncated: csv.truncated,
    };
  }

  return parsePaste(text);
}

function csvLabel(kind: ParsedSource['kind'], fromSpotify: boolean): string {
  if (kind === 'apple-export') return 'Liked songs from Apple Music';
  return fromSpotify ? 'Liked songs from Spotify' : 'Liked songs from a file';
}

export { isParseError, MAX_TRANSFER_ITEMS };
export type { ParseError, ParsedSource };
export type { TransferItem } from '@/lib/import/sources/types';
