'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { api } from '@/lib/api';
import { PRESENCE_INTERVAL_MS } from '@/lib/pranks/presence';
import type { PresenceReport } from '@/lib/pranks/types';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { Track } from '@/types/track';

/** Two reports of the same state closer than this are one too many (a burst
 *  of skips, a double render). */
const MIN_GAP_MS = 3_000;

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

/** Tells the server what this device is playing, for the admin page's
 *  "playing now" line: at once on a track change or play, every 20 s while
 *  playing, and once more on pause. Nothing while idle. Silent: failures are
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

  useEffect(() => {
    if (!userId || !current) return;
    const report = (force: boolean) => {
      const key = `${current.id}|${isPlaying}`;
      const now = Date.now();
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
        .catch(() => {});
    };
    report(false);
    if (!isPlaying) return;
    const timer = setInterval(() => report(true), PRESENCE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [userId, current, isPlaying, engineRef]);
}
