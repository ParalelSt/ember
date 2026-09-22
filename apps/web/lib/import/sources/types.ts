/** What every transfer source hands back.
 *
 *  A source is a pure parser: bytes or text in, a list of source songs out.
 *  Nothing here searches, fetches or writes, so each one is a fixture test
 *  (docs/imports.md and the transfer plan, section 2.6). The result feeds
 *  the same scoring, matching, runner and review screen as a pasted link. */

import type { SourceOrder } from '@/lib/import/likedAt';
import type { ImportCandidate, ImportSourceKind, SourceItem } from '@/lib/import/types';

export type TransferSourceKind =
  | 'spotify-export' // YourLibrary.json from Spotify's "Download your data"
  | 'csv' // Exportify, Soundiiz, TuneMyMusic, spotify-backup, anything with a header row
  | 'paste' // "Artist - Title" lines
  | 'ytmusic-liked'
  | 'lastfm'
  | 'deezer'
  | 'apple-export';

export interface TransferItem extends SourceItem {
  /** Epoch ms when the source says it was liked; null when it does not say
   *  and the date is synthesised at job creation (lib/import/likedAt.ts). */
  likedAt: number | null;
  /** Filled by sources that name the exact YouTube video, so no search is
   *  needed. */
  candidates?: ImportCandidate[];
}

export interface ParsedSource {
  kind: TransferSourceKind;
  /** Shown as the job name: "Liked songs from Spotify". */
  label: string;
  order: SourceOrder;
  items: TransferItem[];
  /** Rows dropped as duplicates or unreadable, for the preview. */
  dropped: number;
  /** The source had more songs than one transfer may carry. */
  truncated: boolean;
}

export interface ParseError {
  error: string;
}

/** Every parser hands back its own result or a sentence saying why not, so
 *  this narrows any of them. */
export function isParseError<T extends object>(r: T | ParseError): r is ParseError {
  return 'error' in r;
}

/** The `import_jobs.source` value for a parsed source. YouTube Music's liked
 *  songs are YouTube Music like any other of its lists. */
export function jobSourceFor(kind: TransferSourceKind): ImportSourceKind {
  return kind === 'ytmusic-liked' ? 'ytmusic' : kind;
}

/** Longest a single field may be. A source that writes an essay into a song
 *  title is cut, not refused. */
export const MAX_FIELD_CHARS = 500;

export function field(value: string, max = MAX_FIELD_CHARS): string {
  return value.trim().slice(0, max);
}
