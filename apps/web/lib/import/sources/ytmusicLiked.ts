/** The person's own liked songs on YouTube Music.
 *
 *  Unlike every other transfer source this one is not a file: it is the
 *  request headers of a signed-in music.youtube.com tab, pasted out of the
 *  browser's developer tools (the steps are in docs/imports.md and in
 *  YTMUSIC_HEADERS_STEPS below, which the dialog renders). YouTube Music then
 *  names the exact video for every song, so the import needs no search at
 *  all: each item arrives with its one candidate already filled in and the
 *  runner accepts it as it is.
 *
 *  Everything here is pure. The headers themselves never reach this file's
 *  output: `checkPastedHeaders` answers with a sentence about shapes and
 *  header names, never with anything it was given. */

import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { readyItem } from '@/lib/import/records';
import { field, type ParseError, type ParsedSource, type TransferItem } from '@/lib/import/sources/types';
import type { Track } from '@/types/track';

/** One liked song as `player.py liked` gives it: the exact video, plus every
 *  artist named (the Track keeps only the first). */
export interface LikedSong {
  track: Track;
  artists: string[];
  /** YouTube Music does not say when a song was liked, so this is null and
   *  the order decides (lib/import/likedAt.ts). Kept because other sources
   *  do say. */
  likedAt: number | null;
}

export const YTMUSIC_LIKED_LABEL = 'Liked songs from YouTube Music';

/** Why the review sheet shows this candidate with no competition. */
const READY_REASON = 'From your YouTube Music likes';

/** A paste this big is not a header block. Generous: a Cookie line alone can
 *  be a couple of kilobytes. */
export const MAX_HEADERS_CHARS = 64 * 1024;

export const HEADERS_STEPS_MESSAGE =
  'Open music.youtube.com on a computer while signed in, press F12, open the Network tab, click any song, ' +
  'find a request called browse, and copy its request headers.';

/** The steps, one line each, for the dialog to render. Kept here so the copy
 *  and the parser that reads the result never drift apart. */
export const YTMUSIC_HEADERS_STEPS: readonly string[] = [
  'On a computer, open music.youtube.com in Chrome, Edge or Firefox and make sure you are signed in.',
  'Press F12 to open the developer tools, then choose the Network tab.',
  'Play any song, or click Library, so requests appear in the list.',
  'Click a request named browse (its address starts with /youtubei/v1/browse).',
  'In Firefox: right-click it, Copy, Copy Request Headers. In Chrome or Edge: open the Headers pane, ' +
    'find "Request Headers", and copy everything under it.',
  'Paste it in the box here. Ember uses it once to read your liked songs and never stores it.',
];

/** What the dialog says under the box, and what docs/imports.md repeats. */
export const YTMUSIC_HEADERS_NOTE =
  'Those headers are your YouTube Music session. Ember sends them straight to the reader, uses them for ' +
  'this one transfer, and keeps no copy. Signing out of YouTube Music afterwards makes them useless to anyone.';

/** Shown on a phone, where there are no developer tools. */
export const YTMUSIC_HEADERS_DESKTOP_ONLY = 'This one needs a desktop browser: do it on a computer.';

/** Chrome and Edge copy a request as a fetch() call, so the headers arrive as
 *  a JSON object rather than as lines. ytmusicapi reads lines, so turn one
 *  into the other; anything else is handed on untouched. */
export function normalisePastedHeaders(raw: string): string {
  const text = raw.trim();
  const pairs: string[] = [];
  const line = /^\s*"([A-Za-z0-9-]+)"\s*:\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/gm;
  for (const m of text.matchAll(line)) {
    try {
      pairs.push(`${m[1]}: ${JSON.parse(m[2]) as string}`);
    } catch {
      // A value this app cannot read is one it cannot pass on either.
    }
  }
  // Only rewrite when the rewrite is the useful shape: a fetch() snippet has
  // its cookie in there, a stray quoted line in a normal paste does not.
  return pairs.some((p) => /^cookie:/i.test(p)) ? pairs.join('\n') : text;
}

/** Is this a header block Ember can use? Answers with what is missing, in
 *  header names, and never quotes the paste back. */
export function checkPastedHeaders(raw: unknown): ParseError | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: `Paste your YouTube Music request headers first. ${HEADERS_STEPS_MESSAGE}` };
  }
  if (raw.length > MAX_HEADERS_CHARS) {
    return { error: 'That is far more text than a block of request headers. Copy just the request headers and try again.' };
  }
  const text = normalisePastedHeaders(raw);
  if (!/(?:^|\n)\s*cookie\s*:/i.test(text)) {
    return { error: `Those lines have no Cookie header, so Ember cannot tell YouTube Music who you are. ${HEADERS_STEPS_MESSAGE}` };
  }
  if (!/apisid|__secure-\w*psid/i.test(text)) {
    return {
      error:
        'That Cookie line is from a signed-out tab. Sign in to music.youtube.com, copy the headers of a browse request again, and paste those.',
    };
  }
  if (!/(?:^|\n)\s*x-goog-authuser\s*:/i.test(text)) {
    return {
      error: `Those headers are missing x-goog-authuser, so they are not from a signed-in browse request. ${HEADERS_STEPS_MESSAGE}`,
    };
  }
  return null;
}

/** The liked songs as a transfer source. Every item carries its one ready
 *  candidate, which is what keeps a 3 000-song transfer off the search. */
export function parseYtmusicLiked(songs: LikedSong[], { truncated = false, dropped = 0 } = {}): ParsedSource {
  const kept = songs.slice(0, MAX_TRANSFER_ITEMS);
  const items: TransferItem[] = kept.map((song, position) => {
    const ready = readyItem(song.track, position, READY_REASON);
    const artists = (song.artists.length ? song.artists : ready.item.artists).map((a) => field(a)).filter(Boolean);
    return {
      ...ready.item,
      title: field(ready.item.title),
      artists,
      artist: artists.join(', '),
      likedAt: song.likedAt,
      candidates: ready.candidates,
    };
  });
  return {
    kind: 'ytmusic-liked',
    label: YTMUSIC_LIKED_LABEL,
    // A YouTube Music liked list reads newest first, which is how the
    // synthesised like dates are laid out.
    order: 'newest-first',
    items,
    dropped,
    truncated: truncated || songs.length > MAX_TRANSFER_ITEMS,
  };
}
