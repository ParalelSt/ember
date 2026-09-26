/** How loud a measured song should play: the gain in dB for a measured
 *  integrated loudness (LUFS) and true peak (dBTP). The server's copy of
 *  loudness.py's compute_gain, so every stored measurement is turned into a
 *  gain with today's policy (a sidecar written under an older one needs no
 *  re-measuring). Keep the two in step: tests/test_loudness.py and
 *  loudnessPolicy.test.ts check the same cases.
 *
 *  The target is where a typical song in the library already sits (-9 LUFS;
 *  the median of a measured sample of the owner's songs was -9.2), not
 *  Spotify's -14. The players cannot push a song past full volume, so -14
 *  turned almost every song down by 4 to 8 dB and made the app quieter. */

export const TARGET_LUFS = -9;
/** Loud masters come down this much at most. */
export const MIN_GAIN_DB = -5;
/** Quiet songs come up this much at most, and only while their true peak
 *  stays under PEAK_CEILING_DB: no player has a limiter. */
export const MAX_GAIN_DB = 6;
export const PEAK_CEILING_DB = -1;
/** ebur128 reports -70 LUFS for silence: nothing to normalize. */
const SILENCE_LUFS = -70;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function gainForMeasurement(lufs: unknown, peakDb: unknown): number {
  if (!finite(lufs) || lufs <= SILENCE_LUFS) return 0;
  let gain = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, TARGET_LUFS - lufs));
  if (gain > 0) {
    // Unknown peak: no boost, it might clip.
    const headroom = finite(peakDb) ? PEAK_CEILING_DB - peakDb : 0;
    gain = Math.max(0, Math.min(gain, headroom));
  }
  // Python's round(x, 2) and no -0.
  return Math.round(gain * 100) / 100 + 0;
}
