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
 *  - tAudio < 0.5s → audio starts cold, trust the LRC → 0
 *  - clamp final value to ±5s.
 *
 *  Order matters: the no-intro guard wins over the clamp. When audio
 *  has no detectable leading silence but LRC claims its first line is
 *  at e.g. 100s, we trust the LRC — shifting the highlight 5s earlier
 *  would be wrong. Only when we DO detect a real intro do we compute
 *  a delta and clamp it. */
export function computeOffset(tAudio: number, tLrcFirst: number): number {
  if (tAudio < NO_INTRO_THRESHOLD_SEC) return 0;
  const raw = tAudio - tLrcFirst;
  if (raw > OFFSET_CLAMP_SEC) return OFFSET_CLAMP_SEC;
  if (raw < -OFFSET_CLAMP_SEC) return -OFFSET_CLAMP_SEC;
  return raw;
}
