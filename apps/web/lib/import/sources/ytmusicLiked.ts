/** The person's own liked songs on YouTube Music, read after they sign in
 *  with Google.
 *
 *  Unlike every other transfer source this one is not a file: Ember asks
 *  Google for a short code, the person allows it on google.com/device, and
 *  the server reads their likes once with the YouTube Data API before it
 *  signs itself out again (lib/import/google/). YouTube names the exact video
 *  for every like, so the import needs no search at all: each item arrives
 *  with its one candidate already filled in. What YouTube does not say is
 *  whether a liked video is a song, so the runner asks YouTube Music about
 *  each one before liking it (lib/import/musicCheck.ts).
 *
 *  Everything here is pure: the parser, and the words the dialog and the
 *  routes say, so the two can never drift apart. */

import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { readyItem } from '@/lib/import/records';
import { field, type ParsedSource, type TransferItem } from '@/lib/import/sources/types';
import type { MusicVideoType } from '@/lib/import/musicCheck';
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
  /** Known before any asking: ATV for an auto-generated Topic channel.
   *  Null or missing: YouTube Music says what it is during the transfer. */
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

/** The line under the preview: Google hands over every like, and which are
 *  songs is only known as the transfer goes. */
export const GOOGLE_CHECKING_LINE =
  'YouTube Music checks each like as the transfer goes: songs are liked, videos that are not music are left out, and uploads it is not sure about wait for a quick check from you.';

/** The liked videos as a transfer source. Every item carries its one ready
 *  candidate, which is what keeps a 3 000-song transfer off the search;
 *  the ones not from a Topic channel are marked for YouTube Music to check. */
export function parseYtmusicLiked(songs: LikedSong[], { truncated = false, dropped = 0 } = {}): ParsedSource {
  const kept = songs.slice(0, MAX_TRANSFER_ITEMS);
  const items: TransferItem[] = kept.map((song, position) => {
    const ready = readyItem(song.track, position, READY_REASON);
    const candidates = ready.candidates.map((c) => (song.videoType ? { ...c, videoType: song.videoType } : { ...c, unchecked: true }));
    const artists = (song.artists.length ? song.artists : ready.item.artists).map((a) => field(a)).filter(Boolean);
    return {
      ...ready.item,
      title: field(ready.item.title),
      artists,
      artist: artists.join(', '),
      likedAt: song.likedAt,
      candidates,
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
