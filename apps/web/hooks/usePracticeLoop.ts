'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { loopJump } from '@/lib/tabPractice';
import { estimateSongSec, type Anchor } from '@/lib/tabSync';

/** How often the loop looks at the playhead (ms): the jump back lands
 *  within this of the loop's end. */
export const LOOP_CHECK_MS = 20;

export interface PracticeLoopOptions {
  /** A loop is set and turned on. Null: no loop. */
  span: { startSec: number; endSec: number } | null;
  /** The tab's song is the one loaded in the player (playing or not). */
  follows: boolean;
  /** ...and it is playing. */
  running: boolean;
  /** Ember's playhead, seconds. */
  position: number;
  rate: number;
  seek: (sec: number) => void;
}

/** Keeps playback inside the loop (lib/tabPractice.ts loopJump): each time
 *  the playhead runs over the loop's end it goes back to its start. A seek
 *  elsewhere is the listener's and is left alone. Turning a loop on with the
 *  playhead outside it starts it from the top. */
export function usePracticeLoop({ span, follows, running, position, rate, seek }: PracticeLoopOptions): void {
  const anchor = useRef<Anchor>({ sec: position, at: 0 });
  const latest = useRef({ span, rate, seek, follows });
  useLayoutEffect(() => {
    latest.current = { span, rate, seek, follows };
  });
  useEffect(() => {
    anchor.current = { sec: position, at: performance.now() };
  }, [position, running]);

  // A loop just turned on (or moved) with the playhead outside it: go to it.
  const startSec = span?.startSec ?? null;
  const endSec = span?.endSec ?? null;
  useEffect(() => {
    // Another song is playing: the loop waits for this one.
    if (startSec === null || endSec === null || !latest.current.follows) return;
    const now = anchor.current.sec;
    if (now < startSec - 0.5 || now >= endSec) {
      latest.current.seek(startSec);
      anchor.current = { sec: startSec, at: performance.now() };
    }
    // Only when the loop itself changes, not on every playhead report
    // (the playhead is read from the anchor ref).
  }, [startSec, endSec, follows]);

  useEffect(() => {
    if (!running || startSec === null) return;
    let prev: number | null = null;
    const id = window.setInterval(() => {
      const { span: s, rate: r, seek: go } = latest.current;
      if (!s) return;
      const sec = estimateSongSec(anchor.current, performance.now(), true, r);
      const to = loopJump(prev, sec, s);
      if (to !== null) {
        go(to);
        anchor.current = { sec: to, at: performance.now() };
        prev = to;
        return;
      }
      prev = sec;
    }, LOOP_CHECK_MS);
    return () => window.clearInterval(id);
  }, [running, startSec]);
}
