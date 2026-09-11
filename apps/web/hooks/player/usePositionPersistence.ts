'use client';

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { resumeStartAt } from '@/lib/playback/resumePosition';
import type { AudioBackend } from '@/lib/playback/types';

export interface PositionPersistence {
  /** Latest-callback ref for `persist`, so backend events wired once at mount
   *  (onPause) still reach the current logic. */
  persistRef: RefObject<() => void>;
  /** Write the trustworthy playhead to the store. */
  persist: () => void;
  /** Record a position report from the backend (the onTime event). */
  noteTime: (sec: number) => void;
  /** Where `trackId` should start, consuming any requested position. Also
   *  hands the stored playhead over to this track. */
  startAt: (trackId: string) => number;
  /** The stored playhead if it belongs to `trackId`, else 0. */
  resumeTargetFor: (trackId: string) => number;
  /** Ask for an explicit start position on the next load. */
  requestStartAt: (sec: number) => void;
}

/** The stored playhead: who owns it, when it is written, and where a track
 *  should resume.
 *
 *  The playhead belongs to exactly ONE track (`positionOwner`); handing it to
 *  a different track is how a new song came to start at the previous song's
 *  timestamp. The rule itself is pure, in lib/playback/resumePosition; this
 *  hook owns the refs around it and the write moments. */
export function usePositionPersistence({
  backendRef,
  backendReady,
}: {
  backendRef: RefObject<AudioBackend | null>;
  backendReady: boolean;
}): PositionPersistence {
  const setPosition = usePlayerStore((s) => s.setPosition);

  // null = "uninitialized, fall back to the persisted store value on read."
  // zustand-persist rehydration completes AFTER first render, so we can't seed
  // from the store's `position`; deferring the lookup to load time is safe.
  const wantPosition = useRef<number | null>(null);
  /** Which track the stored playhead belongs to. Undefined until the first
   *  load, when it is taken to be the persisted track, so a cold start still
   *  resumes where you left off. */
  const positionOwner = useRef<string | undefined>(undefined);
  // Seeded from the store rather than from a render prop: at the provider's
  // first render the two are the same value, and only the first one is kept.
  const lastValidPosition = useRef(usePlayerStore.getState().position);
  const lastPosWrite = useRef(0);
  const persistRef = useRef<() => void>(() => {});

  // Persist the trustworthy position to the store. Skips during a transition
  // (the element reports transient values) and never overwrites with a sus 0.
  const persist = useCallback(() => {
    const b = backendRef.current;
    if (!b || b.isTransitioning()) return;
    const pos = b.getCurrentTime();
    const dur = b.getDuration();
    const havePlayable = dur && dur !== Infinity && dur > 0;
    const trustworthyPos = pos > 0.5 ? pos : lastValidPosition.current;
    if (!havePlayable && trustworthyPos < 0.5) return;
    usePlayerStore.setState({ position: trustworthyPos });
  }, [backendRef]);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  /** The backend reports a position several times a second. Remember the last
   *  trustworthy one for `persist`, and write it through at most once a second
   *  so a reload lands near the playhead without hammering the store. */
  const noteTime = useCallback((sec: number) => {
    if (!backendRef.current?.isTransitioning() && sec > 0.5) {
      lastValidPosition.current = sec;
      const now = Date.now();
      if (now - lastPosWrite.current > 1000) {
        lastPosWrite.current = now;
        usePlayerStore.setState({ position: sec });
      }
    }
  }, [backendRef]);

  const requestStartAt = useCallback((sec: number) => {
    wantPosition.current = sec;
  }, []);

  /** Only resume a position that belongs to the track being retried. A 403 on
   *  the new song used to restart it at the previous song's timestamp. */
  const resumeTargetFor = useCallback(
    (trackId: string) =>
      positionOwner.current === trackId ? usePlayerStore.getState().position : 0,
    [],
  );

  const startAt = useCallback((trackId: string) => {
    if (positionOwner.current === undefined) {
      const st = usePlayerStore.getState();
      positionOwner.current = st.queue[st.index]?.id;
    }
    const at = resumeStartAt({
      trackId,
      positionOwnerId: positionOwner.current,
      storedPosition: usePlayerStore.getState().position,
      requested: wantPosition.current,
    });
    wantPosition.current = null;
    // The playhead now describes THIS track: reset it in the same turn so no
    // later reader (the web-audio fallback, a refresh) can hand one song's
    // position to another, and so the slider doesn't linger on the old time.
    positionOwner.current = trackId;
    usePlayerStore.setState({ position: at });
    setPosition(at);
    return at;
  }, [setPosition]);

  // Periodic + on leave moments. Never overwrites with a sus 0 during a track
  // swap (persist guards on isTransitioning).
  useEffect(() => {
    if (!backendReady) return;
    const b = backendRef.current;
    if (!b) return;
    const periodic = setInterval(() => {
      if (!b.isPaused()) persist();
    }, 5000);
    const onVisibility = () => {
      if (document.hidden) persist();
    };
    const onPagehide = () => persist();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPagehide);
    return () => {
      clearInterval(periodic);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPagehide);
    };
  }, [backendReady, persist, backendRef]);

  // Stable object: loadAndPlay and the backend events capture it once and must
  // keep reaching the live callbacks.
  return useMemo(
    () => ({ persistRef, persist, noteTime, startAt, resumeTargetFor, requestStartAt }),
    [persist, noteTime, startAt, resumeTargetFor, requestStartAt],
  );
}
