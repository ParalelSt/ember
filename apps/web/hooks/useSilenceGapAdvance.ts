'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/components/player/PlayerProvider';
import { decideAdvance } from '@/lib/silenceGap';

interface UseSilenceGapAdvanceOpts {
  /** When false, no rAF loop runs. Use for tracks without plain lyrics
   *  or when there's nothing to advance to (sections.length <= 1). */
  enabled: boolean;
  /** Called once per transition — either a real silence-end edge or
   *  the fallback timer firing. Should be stable across renders
   *  (useCallback in the consumer) to avoid effect tear-down churn. */
  onAdvance: () => void;
  /** Audio time at which the current section started. Anchors the
   *  dwell window and the fallback timer. The consumer updates this
   *  to `getCurrentTime()` whenever a transition fires. */
  anchorTime: number;
}

/** Runs an rAF loop that polls audio RMS via the player provider and
 *  calls `onAdvance()` when the audio crosses a real silence gap or
 *  when the fallback timer expires. All decision logic lives in the
 *  pure `decideAdvance` function so this hook stays thin. */
export function useSilenceGapAdvance({
  enabled,
  onAdvance,
  anchorTime,
}: UseSilenceGapAdvanceOpts): void {
  const { getCurrentTime, getCurrentRMS } = usePlayer();
  const silenceStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Each enable cycle starts fresh — any silence run from the prior
    // section (or a previous enabled period) does not carry over.
    silenceStartRef.current = null;

    let raf = 0;
    const tick = () => {
      const t = getCurrentTime();
      const result = decideAdvance({
        elapsedSec: t - anchorTime,
        rms: getCurrentRMS(),
        silenceStart: silenceStartRef.current,
        t,
      });
      silenceStartRef.current = result.nextSilenceStart;
      if (result.advance) onAdvance();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, anchorTime, getCurrentTime, getCurrentRMS, onAdvance]);
}
