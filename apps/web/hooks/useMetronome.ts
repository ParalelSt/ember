'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { clickContext, clockJumped, LOOKAHEAD_SEC, planClicks, playClick, SCHEDULE_MS } from '@/lib/metronome';
import { estimateSongSec, type Anchor } from '@/lib/tabSync';
import type { Click } from '@/lib/tabTimeline';

export interface MetronomeOptions {
  /** The listener turned it on. */
  on: boolean;
  /** The tab's song is the one playing, and it is playing. */
  running: boolean;
  /** Ember's playhead, seconds (reported a few times a second). */
  position: number;
  /** Playback speed (1: as recorded). */
  rate: number;
  /** The beats in [fromSec, toSec) of the song. */
  beats: (fromSec: number, toSec: number) => Click[];
}

/** Clicks on the beats `beats` hands out, in time with Ember's playhead
 *  (lib/metronome.ts). The playhead between reports runs on by the wall
 *  clock at the playback speed, like the tab's cursor. */
export function useMetronome({ on, running, position, rate, beats }: MetronomeOptions): void {
  const anchor = useRef<Anchor>({ sec: position, at: 0 });
  const latest = useRef({ rate, beats });
  useLayoutEffect(() => {
    latest.current = { rate, beats };
  });
  useEffect(() => {
    anchor.current = { sec: position, at: performance.now() };
  }, [position, running]);

  useEffect(() => {
    if (!on || !running) return;
    const ctx = clickContext();
    if (!ctx) return;
    let last = -Infinity;
    let prev: { sec: number; at: number } | null = null;
    const tick = () => {
      const now = performance.now();
      const { rate: r, beats: beatsIn } = latest.current;
      const sec = estimateSongSec(anchor.current, now, true, r);
      // A seek (or the loop jumping back): start over from here.
      if (clockJumped(prev, sec, now, r)) last = sec - 0.01;
      prev = { sec, at: now };
      let found: Click[] = [];
      try {
        found = beatsIn(sec - 0.02, sec + LOOKAHEAD_SEC * r);
      } catch {
        // A beat that cannot be placed is a silent beat, never an error.
      }
      const plan = planClicks(found, sec, r, last);
      last = plan.last;
      for (const c of plan.clicks) playClick(ctx, ctx.currentTime + c.delay, c.accent);
    };
    tick();
    const id = window.setInterval(tick, SCHEDULE_MS);
    return () => window.clearInterval(id);
  }, [on, running]);
}
