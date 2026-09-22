/** The sentences a transfer says when something is wrong, in one place so
 *  the dialog warns with the same words the upload route would answer
 *  with. Pure: no fetching, no React. */

import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';

const CAP = MAX_TRANSFER_ITEMS.toLocaleString('en-GB');

/** More songs than one transfer may carry. The route refuses the upload,
 *  so the preview says it before the person presses Start. */
export const OVER_CAP_MESSAGE = `Ember can transfer up to ${CAP} songs at once. Split the file and upload it in parts.`;

/** Five uploads an hour. The generic limiter answers in seconds, which
 *  never says what the rule was. */
export const RATE_LIMITED_MESSAGE =
  'That is five uploads in an hour, which is as many as Ember takes. Try the rest a little later.';

/** Three reads of a YouTube Music account an hour: tighter than an upload,
 *  because each one spends somebody's signed-in session on a long read. */
export const YTMUSIC_RATE_LIMITED_MESSAGE =
  'That is three tries in an hour, which is as many as Ember takes for this one. Try again a little later.';

/** When Ember has no idea what went wrong, it still says something a person
 *  can act on. */
export const UNKNOWN_MESSAGE = 'Ember could not read that. Try the file again, or paste your songs instead.';

/** What to show for a failed preview or start. Every refusal the upload
 *  route makes (nothing to read, over 20 MB, over the cap, a zip, UTF-16,
 *  no songs in it) is already a sentence written for people, so it is shown
 *  as it is; the rate limit and anything unrecognised get one here. */
export function transferErrorMessage(e: unknown): string {
  const err = e as { status?: number; message?: string } | undefined;
  if (err?.status === 429) return RATE_LIMITED_MESSAGE;
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  return message && !message.startsWith('Request failed') ? message : UNKNOWN_MESSAGE;
}

/** Same as transferErrorMessage, but for the YouTube Music likes route:
 *  every other refusal it makes (no headers pasted, too much text, no
 *  Cookie line, a signed-out cookie, missing x-goog-authuser, no likes on
 *  the account, YouTube Music unreachable) is already one readable sentence
 *  in `{ error }`, so only the rate limit and the unrecognised case need a
 *  sentence of their own here. */
export function ytmusicLikedErrorMessage(e: unknown): string {
  const err = e as { status?: number; message?: string } | undefined;
  if (err?.status === 429) return YTMUSIC_RATE_LIMITED_MESSAGE;
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  return message && !message.startsWith('Request failed') ? message : UNKNOWN_MESSAGE;
}

export interface TransferResultCounts {
  /** Songs that landed, the transfer's own `accepted`. */
  found: number;
  /** Matched, but not well enough to trust: `review`. */
  check: number;
  /** Nothing plausible anywhere: `missing`. */
  notFound: number;
  /** Songs the person already had liked. Left out when there are none. */
  existing?: number;
}

/** What a finished transfer says, as a sentence rather than four counters:
 *  "We found 812 songs. 41 need a quick check, 6 we could not find." The
 *  one route that never searches by name (YouTube Music, straight from the
 *  account) has nothing to check, so it gets a sentence of its own. */
export function plainTransferResult({ found, check, notFound, existing = 0 }: TransferResultCounts): string {
  const bits: string[] = [];
  if (check > 0) bits.push(`${check} ${check === 1 ? 'needs' : 'need'} a quick check`);
  if (notFound > 0) bits.push(`${notFound} we could not find`);
  if (existing > 0) bits.push(`${existing} you already had`);
  const tail = bits.length > 0 ? ` ${bits.join(', ')}.` : '';
  if (found === 0) return `We found none of your songs.${tail}`;
  const songs = `${found} ${found === 1 ? 'song' : 'songs'}`;
  return bits.length === 0 ? `We found all ${songs}. Nothing to check.` : `We found ${songs}.${tail}`;
}
