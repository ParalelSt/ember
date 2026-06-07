/** Silence threshold in amplitude (linear, not dB). -40 dBFS ≈ 0.01. */
const SILENCE_THRESHOLD = 0.01;
/** Window size for RMS scan, in seconds. */
const WINDOW_SEC = 0.1;
/** Clamp absolute offset to ±this many seconds. */
const OFFSET_CLAMP_SEC = 5;
/** Below this detected intro length, force offset=0 (no detectable silence). */
const NO_INTRO_THRESHOLD_SEC = 0.5;

/** Walk a mono PCM buffer in 100ms windows, return the start time (sec)
 *  of the first window whose RMS exceeds the silence threshold. Returns
 *  0 if nothing crosses the threshold (caller treats this as "no
 *  detectable silence" — see computeOffset). */
export function findFirstNonSilenceSec(samples: Float32Array, sampleRate: number): number {
  const windowSize = Math.round(WINDOW_SEC * sampleRate);
  if (windowSize <= 0 || samples.length < windowSize) return 0;
  const windowCount = Math.floor(samples.length / windowSize);
  for (let w = 0; w < windowCount; w++) {
    const start = w * windowSize;
    let sumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      const v = samples[start + i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    if (rms > SILENCE_THRESHOLD) {
      return w * WINDOW_SEC;
    }
  }
  return 0;
}

/** Compute the per-track LRC offset, with safety rails:
 *  - clamp raw offset to ±5s first
 *  - tAudio < 0.5s AND not already at clamp boundary → audio starts cold,
 *    trust the LRC → 0
 */
export function computeOffset(tAudio: number, tLrcFirst: number): number {
  const raw = tAudio - tLrcFirst;
  if (raw > OFFSET_CLAMP_SEC) return OFFSET_CLAMP_SEC;
  if (raw < -OFFSET_CLAMP_SEC) return -OFFSET_CLAMP_SEC;
  if (tAudio < NO_INTRO_THRESHOLD_SEC) return 0;
  return raw;
}
