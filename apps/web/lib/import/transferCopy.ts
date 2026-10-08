/** The sentences a transfer says when something is wrong, in one place so
 *  the dialog warns with the same words the upload route would answer
 *  with. Pure: no fetching, no React. */

import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';

const CAP = MAX_TRANSFER_ITEMS.toLocaleString('en-GB');

/** More songs than one transfer may carry. The route refuses the upload,
 *  so the preview says it before the person presses Start. */
export const OVER_CAP_MESSAGE = `Ember can transfer up to ${CAP} songs at once. Split the file and upload it in parts.`;

/** A YourLibrary.json longer than one transfer may carry. The file cannot be
 *  split by hand, so Ember starts with what fits instead of refusing, as the
 *  Google route does. */
export const KEPT_FIRST_MESSAGE = `This list is longer than one transfer can carry, so Ember keeps the first ${CAP} songs.`;

/** Said when Skip already liked leaves nothing to bring over. */
export const ALL_LIKED_MESSAGE = 'Every song in that is already in your likes.';

/** About how long a transfer of `count` songs takes, as a phrase: "Under 5
 *  minutes", "About 15 minutes". By name, a batch of 8 songs is about 10
 *  seconds of searching, rounded up to 5 minute steps because the real time
 *  depends on how busy YouTube Music is. An exact transfer (the songs name
 *  their own videos: a Google sign-in, a YouTube Music link) searches for
 *  nothing, so it is about a minute. Empty for no songs. */
export function transferMinutes(count: number, exact = false): string {
  if (count <= 0) return '';
  if (exact) return count > 2000 ? 'About 5 minutes' : 'About a minute';
  const minutes = ((count / 8) * 10) / 60;
  if (minutes < 5) return 'Under 5 minutes';
  return `About ${Math.ceil(minutes / 5) * 5} minutes`;
}

/** The same, as a sentence with what it means for the person. */
export function transferEstimate(count: number): string {
  if (count <= 0) return '';
  return `${transferMinutes(count)}. You can leave this page; the transfer carries on and the Liked songs page shows how far it is.`;
}

/** What the progress chip says is left: "About 15 minutes left". */
export function transferTimeLeft(remaining: number, exact = false): string {
  if (remaining <= 0) return 'Almost done';
  return `${transferMinutes(remaining, exact)} left`;
}

/** Five uploads an hour. The generic limiter answers in seconds, which
 *  never says what the rule was. */
export const RATE_LIMITED_MESSAGE =
  'That is five uploads in an hour, which is as many as Ember takes. Try the rest a little later.';

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

/** Same as transferErrorMessage, but for the Google sign-in routes: every
 *  refusal they make is already one of the sentences in GOOGLE_MESSAGES, so
 *  only the rate limit and the unrecognised case need one here. */
export function googleLikesErrorMessage(e: unknown): string {
  const err = e as { status?: number; message?: string } | undefined;
  if (err?.status === 429) return GOOGLE_MESSAGES.rateLimited;
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  return message && !message.startsWith('Request failed') ? message : GOOGLE_MESSAGES.readFailed;
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
  /** Google likes only: liked videos that were not music. */
  notMusic?: number;
}

/** What a finished transfer says, as a sentence rather than four counters:
 *  "We found 812 songs. 41 need a quick check, 6 we could not find." A
 *  transfer of Google likes also says how many likes were not music, in a
 *  sentence of its own: "We found 9 songs. 3 need a quick check. 7 likes
 *  were not music." */
export function plainTransferResult({ found, check, notFound, existing = 0, notMusic = 0 }: TransferResultCounts): string {
  const bits: string[] = [];
  if (check > 0) bits.push(`${check} ${check === 1 ? 'needs' : 'need'} a quick check`);
  if (notFound > 0) bits.push(`${notFound} we could not find`);
  if (existing > 0) bits.push(`${existing} you already had`);
  const tail =
    (bits.length > 0 ? ` ${bits.join(', ')}.` : '') +
    (notMusic > 0 ? ` ${notMusic} ${notMusic === 1 ? 'like was' : 'likes were'} not music.` : '');
  if (found === 0) return `We found none of your songs.${tail}`;
  const songs = `${found} ${found === 1 ? 'song' : 'songs'}`;
  return tail === '' ? `We found all ${songs}. Nothing to check.` : `We found ${songs}.${tail}`;
}
