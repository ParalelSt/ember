import {
  MAX_FAILURES_IN_A_ROW,
  reasonLabel,
  stoppedPlayback,
  summarizeUnplayable,
  unplayableMessage,
  type UnplayableNotice,
} from './unplayable';

/** What the player bar says about songs that could not play (the owner's
 *  pick from /dizajn/unplayable, option B): the bar's artwork gives way to a
 *  warning sign and its two lines to a short headline and the reason, for a
 *  few seconds, then the song is back. Nothing pops up over the page.
 *
 *  Pure: the wording and the rules are tested here, the store
 *  (stores/useUnplayableStore) times it and the bar draws it. */

/** How long a skip stays in the bar. Anything that stopped the music stays
 *  until the listener acts (see BarLines.sticky). */
export const BAR_MESSAGE_MS = 3000;

/** One message in the bar: the songs it is about (a burst of failures
 *  becomes one message), and whether they failed while the app was away. */
export interface BarMessage {
  /** New for each message (not for a burst merged into it): the bar fades a
   *  new one in, and a merged one just changes its words. */
  key: number;
  notices: UnplayableNotice[];
  away: boolean;
}

/** One entry per song, the latest word on it; nothing for a song only
 *  flagged ahead of time (nothing played or skipped yet). */
export function songsOf(notices: readonly UnplayableNotice[]): UnplayableNotice[] {
  const bySong = new Map<string, UnplayableNotice>();
  for (const n of notices) {
    if (n.outcome === 'flagged') continue;
    bySong.delete(n.trackId);
    bySong.set(n.trackId, n);
  }
  return [...bySong.values()];
}

/** The reason in a few words: the bar's second line, the queue's note. */
export function shortReason(n: Pick<UnplayableNotice, 'kind' | 'reason'>): string {
  if (n.kind === 'transient') return "Couldn't load right now";
  const label = reasonLabel(n.reason);
  return label === reasonLabel(null) ? 'Not available on YouTube' : label;
}

export interface BarLines {
  /** Bold: "Skipped: <title>", "Skipped 3 songs", "Playback stopped". */
  top: string;
  /** The reason, or what to do. */
  bottom: string;
  /** The music stopped: the message stays until the listener acts. */
  sticky: boolean;
  /** A passing failure on the song the player stopped at: a tap tries it
   *  again (anything else opens the queue). */
  retry: boolean;
  /** The whole story in one sentence, for screen readers. */
  announcement: string;
}

function announcementFor(songs: UnplayableNotice[], away: boolean): string {
  const said = (songs.length === 1 ? unplayableMessage(songs[0]) : summarizeUnplayable(songs)) ?? '';
  return away && said ? `While you were away: ${said}` : said;
}

/** The two lines for a message. */
export function barLines(m: Pick<BarMessage, 'notices' | 'away'>): BarLines {
  const songs = songsOf(m.notices);
  const sticky = stoppedPlayback(songs);
  const announcement = announcementFor(songs, m.away);
  const away = (s: string) => (m.away ? `While you were away · ${s}` : s);

  const gaveUp = songs.find((n) => n.outcome === 'gave-up');
  if (gaveUp) {
    return {
      top: 'Playback stopped',
      bottom: `${MAX_FAILURES_IN_A_ROW} songs in a row couldn't play`,
      sticky, retry: false, announcement,
    };
  }
  const stop = songs.find((n) => n.outcome === 'stopped');
  if (stop?.kind === 'transient') {
    return { top: `Couldn't load ${stop.title || 'this song'} right now`, bottom: 'Tap to retry', sticky, retry: true, announcement };
  }
  if (stop) {
    return {
      top: `Couldn't play: ${stop.title || 'this song'}`,
      bottom: away(`${shortReason(stop)} · Nothing left to play`),
      sticky, retry: false, announcement,
    };
  }
  if (songs.length === 1) {
    return { top: `Skipped: ${songs[0].title || 'a song'}`, bottom: away(shortReason(songs[0])), sticky, retry: false, announcement };
  }
  const reasons = new Set(songs.map(shortReason));
  const why = reasons.size === 1
    ? [...reasons][0]
    : songs.every((n) => n.kind === 'unavailable') ? 'Not available on YouTube' : "They wouldn't play";
  return { top: `Skipped ${songs.length} songs`, bottom: away(why), sticky, retry: false, announcement };
}
