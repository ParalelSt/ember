/** A song that could not be played, and what the listener is told about it.
 *
 *  Every engine ends up here: web audio and the desktop engine through the
 *  provider's error path (which asks the host why), the Android player
 *  through its own `unplayable` event (it knows the HTTP answer itself).
 *  Pure, so the wording is tested in one place and reads the same on every
 *  device. */

/** 'unavailable': YouTube says the video is gone (the host answered 410).
 *  'transient': it would not load right now (the host could not fetch it, a
 *  stream that broke), and may well play later. */
export type UnplayableKind = 'unavailable' | 'transient';

/** What the player did about it.
 *  - skipped: moved on to the next song.
 *  - stopped: stayed on it (the end of the queue, or a passing failure the
 *    listener can retry with play).
 *  - gave-up: several songs in a row failed, so playback stopped rather than
 *    racing through the queue.
 *  - flagged: found out ahead of time (a prefetch), nothing played or
 *    skipped yet: the song is only greyed in the queue, no message. */
export type UnplayableOutcome = 'skipped' | 'stopped' | 'gave-up' | 'flagged';

export interface UnplayableNotice {
  trackId: string;
  title: string;
  kind: UnplayableKind;
  /** lib/sources/youtube's UnavailableReason, when the host said which. */
  reason?: string | null;
  outcome: UnplayableOutcome;
}

/** Songs that may fail back to back before the player stops trying (the
 *  Android player has the same number, QueueListener.MAX_ERRORS_IN_A_ROW):
 *  a queue where nothing plays must not spin through every song. */
export const MAX_FAILURES_IN_A_ROW = 5;

/** Short label for a reason code: the queue row's note and badge tooltip. */
export function reasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'removed': return 'Removed from YouTube';
    case 'private': return 'Made private';
    case 'geo': return 'Blocked in this country';
    case 'members': return 'Members only';
    case 'terminated': return 'Channel closed';
    case 'age': return 'Age-restricted on YouTube';
    default: return 'Not available';
  }
}

/** The reason as the end of a sentence ("Couldn't play X: <phrase>."). */
export function reasonPhrase(reason: string | null | undefined): string {
  switch (reason) {
    case 'removed': return 'removed from YouTube';
    case 'private': return 'made private on YouTube';
    case 'geo': return 'not available on YouTube in this country';
    case 'members': return 'for YouTube channel members only';
    case 'terminated': return 'its YouTube channel was closed';
    case 'age': return 'age-restricted on YouTube';
    default: return 'not available on YouTube';
  }
}

function quoted(title: string): string {
  const t = title.trim() || 'this song';
  return t === 'this song' ? t : `"${t}"`;
}

/** The one line for one song, or null when there is nothing to say (a song
 *  only flagged ahead of time). */
export function unplayableMessage(n: UnplayableNotice): string | null {
  if (n.outcome === 'flagged') return null;
  const head = n.kind === 'unavailable'
    ? `Couldn't play ${quoted(n.title)}: ${reasonPhrase(n.reason)}.`
    : `Couldn't load ${quoted(n.title)} right now.`;
  switch (n.outcome) {
    case 'skipped': return `${head} Skipped to the next song.`;
    case 'gave-up': return `${head} Several songs in a row wouldn't play, so playback stopped.`;
    case 'stopped': return n.kind === 'unavailable' ? `${head} Nothing left to play.` : `${head} Press play to try again.`;
  }
}

/** Whether the message is bad news that stopped the music (shown as an
 *  error) or just a skip the music carried on past. */
export function stoppedPlayback(notices: readonly UnplayableNotice[]): boolean {
  return notices.some((n) => n.outcome === 'stopped' || n.outcome === 'gave-up');
}

/** One message for several songs: the ones that failed while the app was in
 *  the background, delivered together when the listener comes back, rather
 *  than a pile of toasts. Null when none of them has anything to say. */
export function summarizeUnplayable(notices: readonly UnplayableNotice[]): string | null {
  const said = notices.filter((n) => n.outcome !== 'flagged');
  // The same song reported twice (a skip, then a give-up on it) is one song.
  const bySong = new Map<string, UnplayableNotice>();
  for (const n of said) bySong.set(n.trackId, n);
  const songs = [...bySong.values()];
  if (songs.length === 0) return null;
  if (songs.length === 1) return unplayableMessage(songs[0]);
  const names = songs.slice(0, 2).map((n) => quoted(n.title));
  const more = songs.length - names.length;
  const list = more > 0 ? `${names.join(', ')} and ${more} more` : names.join(' and ');
  const allGone = songs.every((n) => n.kind === 'unavailable');
  const why = allGone ? "they're not available on YouTube" : "they wouldn't load";
  const end = stoppedPlayback(said) ? 'Playback stopped.' : 'They were skipped.';
  return `Couldn't play ${songs.length} songs (${list}): ${why}. ${end}`;
}

/** The query parameter that marks a load as the listener's own retry ("Tap
 *  to retry"): the host then makes a real attempt even when the song failed
 *  for a passing reason moments ago, instead of handing back the failure it
 *  remembers for the player's automatic retries (lib/sources/failureMemo).
 *  A song YouTube says is gone is still answered from memory. */
export const STREAM_RETRY_PARAM = 'retry';

/** [url] with the retry mark, for the host's YouTube stream route only
 *  (nothing else knows it, and a downloaded or cached copy needs none). */
export function retryStreamUrl(url: string): string {
  if (!/\/api\/youtube\/stream\/[^/?#]+(\?|$)/.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${STREAM_RETRY_PARAM}=1`;
}
