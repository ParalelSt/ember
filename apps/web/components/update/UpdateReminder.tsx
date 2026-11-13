'use client';

import { useEffect, useRef, useState } from 'react';
import { detectDevicePlatform } from '@/lib/versions/device';
import { appUpdateWaitsForTap, subscribeAppUpdate } from '@/lib/appUpdate';
import { checkForUpdates, noteAppUpdateState, requestUpdate, watchPendingUpdate } from '@/lib/update/apply';
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  RECHECK_ON_RETURN_MS,
  SHOW_MS,
  offerKey,
  reminderDelay,
} from '@/lib/update/reminder';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { PILL_CLASS, REMINDER_WORDING, ReminderMark } from './updateReminderLook';

/** How long the slide out takes before the pill is gone (the
 *  ember-update-out keyframes in app/globals.css). */
const OUT_MS = 280;

/** Versions the pill was shown for since this app start (this page load). */
const shown = new Set<string>();
/** Test seam. */
export function resetUpdateReminderForTests(): void {
  shown.clear();
}

/** Where the reminder runs: everywhere. An Android app from before 0.4.34
 *  still has its own pill for its own updates (AppUpdatePill); the reminder
 *  then only says when the web build is newer. */
function reminderPlatform(): boolean {
  return typeof window !== 'undefined';
}

/** A newer Ember, said briefly at the top: "[0.7.44] New version". It slides
 *  in under the top bar, stays SHOW_MS and goes by itself; it comes back at
 *  the next app start until the update is in (lib/update/reminder.ts). A tap
 *  updates when the song playing ends, or at once when nothing plays
 *  (lib/update/apply.ts). It never stops the music. The look is in
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      clearTimeout(hideTimer.current);
      clearTimeout(outTimer.current);
    },
    [],
  );

  const show = () => {
    clearTimeout(hideTimer.current);
    clearTimeout(outTimer.current);
    setPhase('in');
    hideTimer.current = setTimeout(() => {
      setPhase('out');
      outTimer.current = setTimeout(() => setPhase('hidden'), OUT_MS);
    }, SHOW_MS);
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

  // The app could not restart itself: say how to update instead.
  useEffect(() => {
    if (applyFailed && enabled) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFailed, enabled]);

  if (!enabled || phase === 'hidden' || !offer) return null;

  const words = applying
    ? REMINDER_WORDING.applying
    : applyFailed && offer.via === 'android'
      ? REMINDER_WORDING.failed
      : applyFailed || !offer.canApply
      ? REMINDER_WORDING.reopen
      : pending
        ? typeof navigator !== 'undefined' && navigator.onLine === false
          ? REMINDER_WORDING.waitingOnline
          : REMINDER_WORDING.waiting
        : REMINDER_WORDING.ready;

  const tap = () => {
    if (!offer.canApply || (applyFailed && offer.via !== 'android')) {
      show();
      return;
    }
    const r = requestUpdate();
    // Waiting: say so for another few seconds, then go.
    if (r === 'after-song' || r === 'waiting-online') show();
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-block"
      style={{ top: 'calc(var(--ember-topbar-h, 0px) + 0.75rem)' }}
    >
      <button
        type="button"
        data-testid="update-reminder"
        data-kind={offer.kind}
        data-phase={phase}
        role="status"
        aria-label={`Ember ${offer.version}: ${words}`}
        onClick={tap}
        className={`${PILL_CLASS} ${phase === 'out' ? 'ember-update-out' : 'ember-update-in'}`}
      >
        <ReminderMark version={offer.version} />
        <span className="truncate">{words}</span>
      </button>
    </div>
  );
}
