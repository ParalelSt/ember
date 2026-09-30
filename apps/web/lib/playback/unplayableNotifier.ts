import { stoppedPlayback, summarizeUnplayable, unplayableMessage, type UnplayableNotice } from './unplayable';

/** Turns unplayable-song notices into messages without spamming.
 *
 *  - On screen: each report is shown at once (several in one report become
 *    one summary).
 *  - In the background (the page hidden: the phone locked, another app in
 *    front, a minimised window): nothing is shown, notices are kept, and
 *    ONE summary appears when the listener comes back. Toasts that pile up
 *    unseen, or a notification per song, would be noise; the music has
 *    already moved on by itself.
 *  - A song already announced is not announced again for a while (a
 *    loop-all queue walks past the same dead song every lap).
 *
 *  Framework-free: the provider passes in how to show a message and how to
 *  tell whether the page is on screen. */

export interface NotifierDeps {
  /** tone 'error' when playback stopped, 'info' when it carried on. */
  show: (message: string, tone: 'info' | 'error') => void;
  isHidden: () => boolean;
  /** Subscribe to "the page is on screen again"; returns an unsubscribe. */
  onVisible: (fn: () => void) => () => void;
  now?: () => number;
}

export interface UnplayableNotifier {
  /** Several notices in one report (the Android player holds the ones from
   *  while the app was away and hands them over together) become one
   *  summary. */
  report(notices: readonly UnplayableNotice[]): void;
  dispose(): void;
}

/** How long a song, once announced, stays quiet. */
export const REPEAT_QUIET_MS = 10 * 60 * 1000;

export function createUnplayableNotifier(deps: NotifierDeps): UnplayableNotifier {
  const now = deps.now ?? Date.now;
  const pending: UnplayableNotice[] = [];
  const announced = new Map<string, number>();

  /** Drops what needs no word, and skips of a song announced recently (a
   *  loop-all lap walking past it again). Anything that stopped the music
   *  always gets through: the listener pressed play and is owed an answer. */
  function fresh(notices: readonly UnplayableNotice[]): UnplayableNotice[] {
    const t = now();
    return notices.filter((n) => {
      if (!unplayableMessage(n)) return false;
      if (n.outcome !== 'skipped') return true;
      return (announced.get(n.trackId) ?? -Infinity) <= t - REPEAT_QUIET_MS;
    });
  }

  function say(notices: UnplayableNotice[]) {
    const t = now();
    for (const n of notices) announced.set(n.trackId, t);
    const message = notices.length === 1 ? unplayableMessage(notices[0]) : summarizeUnplayable(notices);
    if (message) deps.show(message, stoppedPlayback(notices) ? 'error' : 'info');
  }

  function flush() {
    if (pending.length === 0 || deps.isHidden()) return;
    const batch = fresh(pending.splice(0));
    if (batch.length) say(batch);
  }

  const unsubscribe = deps.onVisible(flush);

  return {
    report(notices) {
      pending.push(...notices);
      // Hidden: kept for the one summary on the way back (flush on visible).
      flush();
    },
    dispose() {
      unsubscribe();
      pending.length = 0;
    },
  };
}

/** The browser's own signals, for the provider. */
export function documentVisibility(): Pick<NotifierDeps, 'isHidden' | 'onVisible'> {
  return {
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisible: (fn) => {
      if (typeof document === 'undefined') return () => {};
      const handler = () => { if (document.visibilityState === 'visible') fn(); };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
  };
}
