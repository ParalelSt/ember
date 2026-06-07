/** RMS amplitude below this is "silent". ~−40 dBFS, same threshold the
 *  intro-silence aligner uses. */
export const SILENCE_THRESHOLD = 0.01;

/** A silence run shorter than this is treated as a momentary dip and
 *  does NOT fire an advance on the rising edge. Filters codec clicks,
 *  brief vocal cutoffs inside a section, etc. */
export const MIN_SILENCE_SEC = 0.3;

/** After any advance, ignore silence for this long. A section that
 *  ends in a pause won't ricochet into another transition. */
export const MIN_DWELL_SEC = 5;

/** Hard fallback. If no silence-driven advance has fired this long
 *  after the section started, advance anyway. Keeps continuous tracks
 *  (electronic, hip-hop) from sitting on one section forever. */
export const FALLBACK_SEC = 45;

export interface SilenceGapInput {
  /** Seconds since the current section started (anchorTime). */
  elapsedSec: number;
  /** Current audio RMS (linear amplitude). */
  rms: number;
  /** Audio time at which the in-progress silence run started, or null
   *  if not currently in silence. */
  silenceStart: number | null;
  /** Current audio time. Used to start a new silence run and to
   *  measure gap length on the rising edge. */
  t: number;
}

export interface SilenceGapResult {
  /** True = the consumer should advance to the next section. */
  advance: boolean;
  /** New value the consumer should persist for the next tick's
   *  `silenceStart`. Cleared (null) on dwell guard and on every
   *  resolved edge. */
  nextSilenceStart: number | null;
}

/** Pure per-tick decision for the silence-gap section advancer.
 *  No React, no refs, no timers — same input always yields same output.
 *  The hook in `useSilenceGapAdvance` calls this on every rAF frame,
 *  persisting `nextSilenceStart` between calls. */
export function decideAdvance(input: SilenceGapInput): SilenceGapResult {
  const { elapsedSec, rms, silenceStart, t } = input;

  // Within dwell: ignore everything, including any in-progress silence
  // run, so silence that started during the dwell window can't trigger
  // a rising-edge advance the moment dwell ends.
  if (elapsedSec < MIN_DWELL_SEC) {
    return { advance: false, nextSilenceStart: null };
  }

  const inSilence = rms < SILENCE_THRESHOLD;

  if (inSilence) {
    // Start a new run if we weren't already in one; otherwise preserve.
    return { advance: false, nextSilenceStart: silenceStart ?? t };
  }

  // Audio is not silent. If we WERE in silence, this is the rising edge.
  if (silenceStart !== null) {
    const gapLen = t - silenceStart;
    if (gapLen >= MIN_SILENCE_SEC) {
      return { advance: true, nextSilenceStart: null };
    }
    // Brief blip — drop the run, no advance.
    return { advance: false, nextSilenceStart: null };
  }

  // Loud audio with no prior silence run. Check the fallback timer.
  if (elapsedSec >= FALLBACK_SEC) {
    return { advance: true, nextSilenceStart: null };
  }

  return { advance: false, nextSilenceStart: null };
}
