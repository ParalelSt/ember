/** A pasted list of songs, one per line.
 *
 *  The fallback that always works: whatever service someone is leaving, they
 *  can select their liked songs and paste the list. Accepted shapes:
 *
 *    Artist - Title          the usual one
 *    Artist – Title          en dash, what most apps copy
 *    Title by Artist
 *    Title                   artist unknown, searched on the title alone
 *
 *  A number in front ("12. ", "12) ") and a length at the end ("3:45") are
 *  what copying from a web page adds, so both are stripped. Pure. */

import { field, type ParseError, type ParsedSource, type TransferItem } from '@/lib/import/sources/types';

/** Lines read before giving up: past this it is not a hand-pasted list. */
export const MAX_PASTE_LINES = 10_000;
/** Longest line kept. */
export const MAX_PASTE_LINE_CHARS = 300;

const NUMBERING = /^\s*\d{1,5}\s*[.)\]]\s+/;
const TRAILING_TIME = /\s+[(\[]?\d{1,2}:[0-5]\d(?::[0-5]\d)?[)\]]?\s*$/;
/** A hyphen, en dash or em dash with spaces either side: the separator every
 *  app uses, and never part of a name written that way. */
const SEPARATOR = /\s+[-–—]\s+/;

export function parsePaste(text: string): ParsedSource | ParseError {
  const all = text.split(/\r?\n/);
  const lines = all.slice(0, MAX_PASTE_LINES);
  const items: TransferItem[] = [];
  let dropped = 0;

  for (const raw of lines) {
    const line = raw.replace(NUMBERING, '').replace(TRAILING_TIME, '').trim().slice(0, MAX_PASTE_LINE_CHARS);
    if (!line) continue;

    let artist = '';
    let title = line;
    const parts = line.split(SEPARATOR);
    if (parts.length >= 2) {
      // "Artist - Title - Remix" keeps everything after the first separator
      // as the title, so a title with its own dash survives.
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    } else {
      const by = /^(.*\S)\s+by\s+(\S.*)$/i.exec(line);
      if (by) {
        title = by[1].trim();
        artist = by[2].trim();
      }
    }
    if (!title) {
      dropped++;
      continue;
    }

    items.push({
      position: items.length,
      title: field(title),
      artists: artist ? [field(artist)] : [],
      artist: field(artist),
      durationMs: null,
      explicit: null,
      uri: null,
      likedAt: null,
    });
  }

  if (!items.length) return { error: 'Ember could not read a song out of that. Paste one song per line, as "Artist - Title".' };

  return {
    kind: 'paste',
    label: 'Liked songs from a list',
    // What someone pastes is almost always a liked list copied top down.
    order: 'newest-first',
    items,
    dropped,
    truncated: all.length > MAX_PASTE_LINES,
  };
}
