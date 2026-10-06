'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clickContext, playClick } from '@/lib/metronome';
import type { CountInPlan } from '@/lib/tabStage';

/** A little room before the first click, so it is not cut short. */
const LEAD_SEC = 0.05;

export interface CountIn {
  /** The beat being counted (0-based over the whole count), or null. */
  beat: number | null;
  beatsPerBar: number;
  /** Click `plan` out, then call `onDone`. A count already running is
   *  dropped first. */
  start: (plan: CountInPlan, onDone: () => void) => void;
  /** Stop counting: no more clicks, and `onDone` is never called. */
  cancel: () => void;
}

/** The count-in before the song starts from the tab page's pill: the
 *  clicks on the metronome's AudioContext (made on the press, as browsers
 *  ask), the beat for the pill to show, and the start when it is over.
 *  Everything stops when the page goes. */
export function useCountIn(): CountIn {
  const [beat, setBeat] = useState<number | null>(null);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const run = useRef<{ timers: number[]; silence: (() => void)[] } | null>(null);

  const cancel = useCallback(() => {
    const r = run.current;
    run.current = null;
    if (!r) return;
    for (const t of r.timers) window.clearTimeout(t);
    for (const s of r.silence) s();
    setBeat(null);
  }, []);

  const start = useCallback(
    (plan: CountInPlan, onDone: () => void) => {
      cancel();
      if (plan.clicks.length === 0) {
        onDone();
        return;
      }
      const ctx = clickContext();
      const lead = ctx ? LEAD_SEC : 0;
      const r: { timers: number[]; silence: (() => void)[] } = { timers: [], silence: [] };
      run.current = r;
      setBeatsPerBar(plan.beatsPerBar);
      plan.clicks.forEach((c, i) => {
        if (ctx) r.silence.push(playClick(ctx, ctx.currentTime + lead + c.atSec, c.accent));
        r.timers.push(window.setTimeout(() => setBeat(i), (lead + c.atSec) * 1000));
      });
      r.timers.push(
        window.setTimeout(() => {
          if (run.current !== r) return;
          run.current = null;
          setBeat(null);
          onDone();
        }, (lead + plan.totalSec) * 1000),
      );
    },
    [cancel],
  );

  // The page closing ends the count, and the song never starts.
  useEffect(() => cancel, [cancel]);

  return { beat, beatsPerBar, start, cancel };
}
