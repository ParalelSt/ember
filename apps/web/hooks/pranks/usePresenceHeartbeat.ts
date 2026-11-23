'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { api } from '@/lib/api';
import { claimSingleton, createBackoff, releaseSingleton, retryAfterOf } from '@/lib/pranks/backoff';
import { PRESENCE_INTERVAL_MS } from '@/lib/pranks/presence';
import type { PresenceReport } from '@/lib/pranks/types';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { Track } from '@/types/track';

/** Two reports of the same state closer than this are one too many (a burst
 *  of skips, a double render). */
const MIN_GAP_MS = 3_000;

/** Reports outside the 20 s beat (track change, play, pause) are capped per
 *  window, so a state that flaps cannot become a flood. */
const BURST_WINDOW_MS = 30_000;
const BURST_MAX = 8;

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

/** Tells the server what this device is playing, for the admin page's
 *  "playing now" line: at once on a track change or play, every 20 s while
 *  playing, and once more on pause. Nothing while idle or while the page is
 *  hidden (one report as soon as it is shown again). Silent: failures are
 *  dropped. */
export function usePresenceHeartbeat({
  userId,
  current,
  isPlaying,
  engineRef,
  send = (r: PresenceReport) => api.pranks.presence(r),
}: {
  userId: string | null;
  current: Track | null;
  isPlaying: boolean;
  engineRef: RefObject<string>;
  send?: (report: PresenceReport) => Promise<unknown>;
}) {
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const last = useRef({ key: '', at: 0 });
  const backoff = useRef(createBackoff());
  const burst = useRef<number[]>([]);

  useEffect(() => {
    if (!userId || !current) return;
    const owner = Symbol('presence');
    if (!claimSingleton('presence', owner)) return;
    const report = (beat: boolean) => {
      const force = beat;
      const key = `${current.id}|${isPlaying}`;
      const now = Date.now();
      // Nothing while the page is hidden (screen off, another app in front):
      // showing it again reports at once (onVisible below).
      if (typeof document !== 'undefined' && document.hidden) return;
      if (backoff.current.blocked(now)) return;
      if (!beat) {
        burst.current = burst.current.filter((t) => now - t < BURST_WINDOW_MS);
        if (burst.current.length >= BURST_MAX) return;
        burst.current.push(now);
      }
      if (!force && last.current.key === key && now - last.current.at < MIN_GAP_MS) return;
      last.current = { key, at: now };
      const st = usePlayerStore.getState();
      void sendRef
        .current({
          // Uploads can carry no length; the engine's own figure fills in.
          track: { id: current.id, title: current.title, artist: current.artist, durationSec: current.durationSec || st.duration },
          position: st.position,
          isPlaying,
          engine: engineRef.current,
          appVersion: APP_VERSION,
        })
        .then(() => backoff.current.ok())
        .catch((e) => backoff.current.fail(retryAfterOf(e)));
    };
    report(false);
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => report(true), PRESENCE_INTERVAL_MS);
    };
    if (isPlaying && !document.hidden) start();
    // The beat stops while the page is hidden; shown again, one report at
    // once and the beat starts over. Paused, there is no beat, but a pause
    // made while hidden (the lock screen) is reported on coming back.
    const onVisible = () => {
      if (document.hidden) {
        clearInterval(timer);
        timer = undefined;
        return;
      }
      if (isPlaying) {
        report(true);
        start();
      } else if (last.current.key !== `${current.id}|false`) {
        report(false);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      releaseSingleton('presence', owner);
    };
  }, [userId, current, isPlaying, engineRef]);
}
