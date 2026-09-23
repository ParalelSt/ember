/** The person's own liked songs on YouTube Music, read after they sign in
 *  with Google.
 *
 *  Unlike every other transfer source this one is not a file: Ember asks
 *  Google for a short code, the person allows it on google.com/device, and
 *  the server reads their likes once with the YouTube Data API before it
 *  signs itself out again (lib/import/google/). YouTube names the exact video
 *  for every like, so the import needs no search at all: each item arrives
 *  with its one candidate already filled in. What YouTube does not say is
 *  whether a liked video is a song, so before the preview the likes go
 *  through two passes: the uploader's own category (lib/import/google/
 *  likes.ts), then YouTube Music's word on each survivor
 *  (lib/import/musicCheck.ts). Only songs reach the transfer.
 *
 *  Everything here is pure: the parser, and the words the dialog and the
 *  routes say, so the two can never drift apart. */

import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { readyItem } from '@/lib/import/records';
import { field, type ParsedSource, type TransferItem } from '@/lib/import/sources/types';
import { likeOutcome, songCandidate, type MusicVideoType } from '@/lib/import/musicCheck';
import type { Track } from '@/types/track';

/** One liked song: the exact video, plus every artist named (the Track
 *  keeps only the first). */
export interface LikedSong {
  track: Track;
  artists: string[];
  /** YouTube does not say when a song was liked, so this is null and the
   *  order decides (lib/import/likedAt.ts). Kept because other sources do
   *  say. */
  likedAt: number | null;
  /** What YouTube Music calls it: ATV straight away for an auto-generated
   *  Topic channel, the rest once YouTube Music has been asked (before the
   *  preview). Null or missing: not music. */
  videoType?: MusicVideoType | null;
}

export const YTMUSIC_LIKED_LABEL = 'Liked songs from YouTube Music';

/** Why the review sheet shows this candidate with no competition. */
export const READY_REASON = 'From your YouTube Music likes';

/** The steps above the button, one line each. */
export const GOOGLE_SIGNIN_STEPS: readonly string[] = [
  'Press Sign in with Google below. Ember shows you a short code.',
  'Open google.com/device on this device or on your phone, type the code, and pick the Google account you use for YouTube Music.',
  'Google asks whether Ember may see your YouTube account. Say yes, then come back here.',
];

/** What happens to the sign-in, said before anyone presses anything. */
export const GOOGLE_FORGET_NOTE =
  'Ember reads your likes once, then signs itself out of your Google account and forgets it. Nothing about the account is kept.';

/** Google's likes hold every video, not only songs. */
export const GOOGLE_MUSIC_ONLY_NOTE =
  'Only music comes across: YouTube Music says which of your likes are songs, and videos that are not music are left out.';

/** Every sentence the Google sign-in can end with. The routes answer with
 *  these and the dialog shows them as they are. */
export const GOOGLE_MESSAGES = {
  notConfigured: 'This server is not set up for Google sign-in yet.',
  denied: "You said no on Google's page, so nothing was read.",
  expired: 'The code ran out. Press Sign in with Google to get a new one.',
  noScope: 'Google did not let Ember see your YouTube likes, so nothing was read. Sign in again and leave that box ticked.',
  blocked: "Google blocked this sign-in for that account. The person who runs Ember needs to publish Ember's Google project so any account can use it.",
  setupWrong: "Google turned down this server's sign-in setup, so the person who runs Ember needs to check it.",
  busy: 'Google is handing out too many codes right now. Try again in a minute.',
  unreachable: 'Google did not answer. Try again in a moment.',
  quota: "Google's daily limit for this server is used up. Try again tomorrow.",
  readFailed: 'Ember could not read your likes from Google. Press Sign in with Google to try again.',
  checkFailed:
    "YouTube Music isn't answering right now, so Ember could not tell which of your likes are songs. Press Sign in with Google to try again in a few minutes.",
  noLikes: 'There are no liked songs on that Google account yet.',
  gone: 'That sign-in is over. Press Sign in with Google to start again.',
  rateLimited: 'That is a lot of sign-ins in an hour. Try again a little later.',
} as const;

export type GoogleFailure = keyof typeof GOOGLE_MESSAGES;

/** Under the code, while waiting: Ember's Google project is published but not
 *  reviewed by Google, so every account meets Google's warning page first.
 *  Said up front so nobody backs out of it thinking something is wrong. */
export const GOOGLE_UNVERIFIED_HINT =
  "Google will say it hasn't verified Ember. That is expected for a small private app: press Continue, or Advanced and then Go to Ember.";

/** Under the not-configured sentence: the way in that needs no sign-in. */
export const GOOGLE_FALLBACK_HINT = 'You can still bring your likes over as a playlist link.';

/** A Google account whose likes are all videos, not songs, by the first
 *  pass (the uploader's own category). */
export function noMusicMessage(skipped: number): string {
  return skipped > 0
    ? `None of the ${skipped} ${skipped === 1 ? 'video' : 'videos'} you liked on that Google account ${skipped === 1 ? 'is' : 'are'} music, so there is nothing to bring over.`
    : GOOGLE_MESSAGES.noLikes;
}

/** Likes that passed the first pass, none of which YouTube Music calls a
 *  song. */
export function noSongsMessage(likes: number): string {
  return `YouTube Music says none of the ${likes} ${likes === 1 ? 'like' : 'likes'} on that Google account ${likes === 1 ? 'is a song' : 'are songs'}, so there is nothing to bring over.`;
}

/** The waiting line during the second pass. */
export function checkingLine(done: number, total: number): string {
  return `Checking which likes are songs: ${done} of ${total}`;
}

/** Under the preview: uploads that come across only after a yes. */
export function toCheckLine(n: number): string {
  return `${n} more ${n === 1 ? 'needs' : 'need'} a quick check: ${n === 1 ? 'an upload' : 'uploads'} YouTube Music is not sure ${n === 1 ? 'is a song' : 'are songs'}.`;
}

/** The checked likes as a transfer source. Every item carries its one
 *  ready candidate, which is what keeps a 3 000-song transfer off the
 *  search. Songs (ATV, OMV) come first, in Google's order, and are liked by
 *  the runner as they are; an upload (UGC) is created waiting in the review
 *  list; a like that is not music comes last, already skipped, only so the
 *  finished transfer can count it. The Liked page never shows it. */
export function parseYtmusicLiked(songs: LikedSong[], { truncated = false, dropped = 0 } = {}): ParsedSource {
  const kept = songs.slice(0, MAX_TRANSFER_ITEMS);
  const outcome = (s: LikedSong) => likeOutcome(s.videoType);
  const ordered = [...kept.filter((s) => outcome(s) !== 'skipped'), ...kept.filter((s) => outcome(s) === 'skipped')];
  const items: TransferItem[] = ordered.map((song, position) => {
    const ready = readyItem(song.track, position, READY_REASON);
    const type = song.videoType ?? null;
    const status = outcome(song);
    const artists = (song.artists.length ? song.artists : ready.item.artists).map((a) => field(a)).filter(Boolean);
    return {
      ...ready.item,
      title: field(ready.item.title),
      artists,
      artist: artists.join(', '),
      likedAt: song.likedAt,
      candidates: ready.candidates.map((c) => songCandidate(c, type)),
      ...(status === 'accepted' ? {} : { status }),
    };
  });
  return {
    kind: 'ytmusic-liked',
    label: YTMUSIC_LIKED_LABEL,
    // Google lists likes newest first, which is how the synthesised like
    // dates are laid out.
    order: 'newest-first',
    items,
    dropped,
    truncated: truncated || songs.length > MAX_TRANSFER_ITEMS,
  };
}
