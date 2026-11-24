import type { UpdateOffer } from './check';

/** When the update reminder (components/update/UpdateReminder) shows. Pure,
 *  so each rule is tested on its own.
 *
 *  Owner's picks: a banner at the top that stays until it is tapped or put
 *  away with its close button (2026-11-24: six seconds was too easy to
 *  miss). Once per app start for each new version, until it is installed
 *  (an app start is a page load: the next launch, or the reload that brings
 *  the update in); put away, it comes back at the next start. Never in the
 *  first seconds after a song starts. */

/** How long after playback starts the pill keeps away. */
export const QUIET_AFTER_PLAY_MS = 8000;
/** The first check, after the app has settled in. */
export const FIRST_CHECK_MS = 15_000;
/** Checks while the app stays open (a desktop window can stay open for
 *  days, and the host updates under it). */
export const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Coming back to the window checks again, at most this often. */
export const RECHECK_ON_RETURN_MS = 10 * 60 * 1000;

export function offerKey(offer: Pick<UpdateOffer, 'kind' | 'version'>): string {
  return `${offer.kind}:${offer.version}`;
}

/** How long to wait before showing the pill: 0 now, more to wait out the
 *  start of a song, null not at all (nothing new, or already shown for
 *  this version since the app started). */
export function reminderDelay(input: {
  offer: UpdateOffer | null;
  shown: ReadonlySet<string>;
  isPlaying: boolean;
  /** When playback last started (ms), 0 when unknown. */
  playingSince: number;
  now: number;
}): number | null {
  const { offer, shown, isPlaying, playingSince, now } = input;
  if (!offer || shown.has(offerKey(offer))) return null;
  if (isPlaying && playingSince > 0) {
    const left = playingSince + QUIET_AFTER_PLAY_MS - now;
    if (left > 0) return left;
  }
  return 0;
}
