'use client';

import { useEffect, useRef, useState } from 'react';
import { detectShell } from '@/lib/playback/detectShell';
import { detectDevicePlatform } from '@/lib/versions/device';
import { appUpdateWaitsForTap, subscribeAppUpdate } from '@/lib/appUpdate';
import { checkForUpdates, noteAppUpdateState, requestUpdate, watchPendingUpdate } from '@/lib/update/apply';
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  RECHECK_ON_RETURN_MS,
  offerKey,
  reminderDelay,
} from '@/lib/update/reminder';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { ACTION_CLASS, ACTION_LABEL_CLASS, CLOSE_CLASS, PILL_CLASS, REMINDER_WORDING, ReminderMark } from './updateReminderLook';

/** How long the slide out takes before the pill is gone (the
 *  ember-update-out keyframes in app/globals.css). */
const OUT_MS = 280;

/** Versions the pill was shown for since this app start (this page load). */
const shown = new Set<string>();
/** Test seam. */
export function resetUpdateReminderForTests(): void {
  shown.clear();
}

/** Where the reminder runs: inside the desktop app and the Android app
 *  only (owner, 2026-11-14). A browser tab is on the newest web build after
 *  any reload, and the iPhone app cannot update itself. An Android app from
 *  before 0.4.34 keeps its own pill for its own updates (AppUpdatePill); the
 *  reminder there only says when the web build is newer. */
export function reminderPlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return detectShell() === 'tauri' || detectDevicePlatform() === 'android';
}

/** A newer Ember, said at the top: "[0.7.44] New version ready  [Update]".
 *  It slides in under the top bar and stays until it is tapped or put away
 *  with its close button ("Not now"); put away, it comes back at the next
 *  app start until the update is in (lib/update/reminder.ts). A tap updates
 *  now, even while a song plays: the song and its position are kept and it
 *  starts again once back (lib/update/apply.ts). The look is in
 *  updateReminderLook.tsx. Also runs the checks themselves. */
export function UpdateReminder() {
  const offer = useUpdateStore((s) => s.offer);
  const pending = useUpdateStore((s) => s.pending);
  const applying = useUpdateStore((s) => s.applying);
  const applyFailed = useUpdateStore((s) => s.applyFailed);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const [phase, setPhase] = useState<'hidden' | 'in' | 'out'>('hidden');
  const [enabled, setEnabled] = useState(false);
  const [tick, setTick] = useState(0);
  const playingSince = useRef(0);
  const outTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setEnabled(reminderPlatform()), []);

  // The checks: once the app has settled in, then now and then while it
  // stays open, and on coming back to the window.
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
    const every = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const { checkedAt } = useUpdateStore.getState();
      if (checkedAt > 0 && Date.now() - checkedAt >= RECHECK_ON_RETURN_MS) void checkForUpdates();
    };
    document.addEventListener('visibilitychange', onVisible);
    const offPending = watchPendingUpdate();
    // The Android app's own updater (one that waits for a tap): what it
    // finds, downloads and installs.
    const offApp =
      detectDevicePlatform() === 'android' && appUpdateWaitsForTap()
        ? subscribeAppUpdate((s) => void noteAppUpdateState(s))
        : () => {};
    return () => {
      offApp();
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
      offPending();
    };
  }, [enabled]);

  // When the music last started: the pill keeps away from that moment.
  useEffect(
    () =>
      usePlayerStore.subscribe((s, prev) => {
        if (s.isPlaying && !prev.isPlaying) playingSince.current = Date.now();
      }),
    [],
  );

  useEffect(
    () => () => {
      clearTimeout(outTimer.current);
    },
    [],
  );

  const show = () => {
    clearTimeout(outTimer.current);
    setPhase('in');
  };

  /** "Not now": it slides away and comes back at the next app start. */
  const dismiss = () => {
    clearTimeout(outTimer.current);
    setPhase('out');
    outTimer.current = setTimeout(() => setPhase('hidden'), OUT_MS);
  };

  // A new update: show once, out of the way of a song that just started.
  useEffect(() => {
    if (!enabled) return;
    const delay = reminderDelay({ offer, shown, isPlaying, playingSince: playingSince.current, now: Date.now() });
    if (delay === null || !offer) return;
    if (delay > 0) {
      const t = setTimeout(() => setTick((n) => n + 1), delay);
      return () => clearTimeout(t);
    }
    shown.add(offerKey(offer));
    show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, offer, isPlaying, tick]);

  // The app could not download or install it: say so (a tap tries again).
  useEffect(() => {
    if (applyFailed && enabled) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFailed, enabled]);

  if (!enabled || phase === 'hidden' || !offer) return null;

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const failed = applyFailed && offer.via !== 'reload';
  const words = applying
    ? REMINDER_WORDING.applying
    : failed
      ? REMINDER_WORDING.failed
      : !offer.canApply
        ? REMINDER_WORDING.reopen
        : pending && offline
          ? REMINDER_WORDING.waitingOnline
          : REMINDER_WORDING.ready;
  // The action button: only where a tap does something.
  const action = applying || !offer.canApply || (pending && offline)
    ? null
    : failed
      ? REMINDER_WORDING.retry
      : REMINDER_WORDING.action;

  const tap = () => {
    if (!offer.canApply) return;
    requestUpdate();
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-block"
      style={{ top: 'calc(var(--ember-topbar-h, 0px) + 0.75rem)' }}
    >
      <div
        data-testid="update-reminder"
        data-kind={offer.kind}
        data-phase={phase}
        role="status"
        className={`${PILL_CLASS} ${phase === 'out' ? 'ember-update-out' : 'ember-update-in'}`}
      >
        <button
          type="button"
          data-testid="update-reminder-action"
          aria-label={`Ember ${offer.version}: ${words}${action ? `. ${action}` : ''}`}
          onClick={tap}
          className={ACTION_CLASS}
        >
          <ReminderMark version={offer.version} />
          <span className="min-w-0 flex-1 truncate">{words}</span>
          {action && <span className={ACTION_LABEL_CLASS}>{action}</span>}
        </button>
        <button
          type="button"
          data-testid="update-reminder-close"
          aria-label={REMINDER_WORDING.dismiss}
          onClick={dismiss}
          className={CLOSE_CLASS}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
