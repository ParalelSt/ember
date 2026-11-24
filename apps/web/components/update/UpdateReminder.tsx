'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
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
import { ACTION_CLASS, ACTION_LABEL_CLASS, PILL_CLASS, REMINDER_WORDING, ReminderMark } from './updateReminderLook';

/** How long the slide out takes before the pill is gone (the
 *  slide out after a swipe). */
const OUT_MS = 240;
/** Dragged this far (px) a release slides it away; less springs back. */
export const SWIPE_AWAY_PX = 70;
/** A quick flick (px per ms) also counts, past FLICK_MIN_PX. */
const FLICK_SPEED = 0.5;
const FLICK_MIN_PX = 20;
/** Moved more than this (px) is a drag, not a tap. */
const DRAG_SLOP_PX = 8;

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

/** A newer Ember, said in a full-width bar under the top bar:
 *  "[0.7.44] New version ready  [Update]". It slides in and stays until it is
 *  tapped or swiped away left or right (Escape does the same from the
 *  keyboard); put away, it comes back at the next
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
  const drag = useRef<{ x0: number; t0: number; id: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
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

  /** Swiped away: it slides out and comes back at the next app start. */
  const dismiss = (dir: 1 | -1 = 1) => {
    clearTimeout(outTimer.current);
    setDx(dir * 600);
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

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (phase === 'out') return;
    drag.current = { x0: e.clientX, t0: Date.now(), id: e.pointerId, moved: false };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* no capture: the drag still follows moves over the bar */
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = e.clientX - d.x0;
    if (!d.moved && Math.abs(x) <= DRAG_SLOP_PX) return;
    d.moved = true;
    setDragging(true);
    setDx(x);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = e.clientX - d.x0;
    const speed = Math.abs(x) / Math.max(1, Date.now() - d.t0);
    setDragging(false);
    if (d.moved && (Math.abs(x) >= SWIPE_AWAY_PX || (Math.abs(x) >= FLICK_MIN_PX && speed >= FLICK_SPEED))) {
      dismiss(x < 0 ? -1 : 1);
    } else {
      setDx(0);
    }
    // The click that follows a drag must not count as a tap on Update.
    if (d.moved) setTimeout(() => (drag.current = null), 0);
    else drag.current = null;
  };
  const onCancel = () => {
    drag.current = null;
    setDragging(false);
    setDx(0);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') dismiss();
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-40"
      style={{ top: 'var(--ember-topbar-h, 0px)' }}
    >
      <div
        data-testid="update-reminder"
        data-kind={offer.kind}
        data-phase={phase}
        role="status"
        {...{ 'aria-description': REMINDER_WORDING.swipeHint }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onKeyDown={onKey}
        style={{
          touchAction: 'pan-y',
          transform: dx ? `translateX(${dx}px)` : undefined,
          opacity: phase === 'out' ? 0 : dx ? Math.max(0.35, 1 - Math.abs(dx) / 300) : undefined,
          transition: dragging ? 'none' : `transform ${OUT_MS}ms ease-out, opacity ${OUT_MS}ms ease-out`,
        }}
        className={`${PILL_CLASS} ember-update-drag ${phase === 'in' ? 'ember-update-in' : ''}`}
      >
        <button
          type="button"
          data-testid="update-reminder-action"
          aria-label={`Ember ${offer.version}: ${words}${action ? `. ${action}` : ''}`}
          onClick={(e) => {
            if (drag.current?.moved) {
              e.preventDefault();
              return;
            }
            tap();
          }}
          className={ACTION_CLASS}
        >
          <ReminderMark version={offer.version} />
          <span className="min-w-0 flex-1 truncate">{words}</span>
          {action && <span className={ACTION_LABEL_CLASS}>{action}</span>}
        </button>
      </div>
    </div>
  );
}
