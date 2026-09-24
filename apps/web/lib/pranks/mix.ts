/** How a prank sound and the music share the speaker. Pure. */

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** The slider value handed to the backend's setVolume: muted is silence,
 *  and a ducking sound scales the music down (1 = no duck). */
export function musicLevel(volume: number, muted: boolean, duck: number): number {
  return muted ? 0 : clamp01(volume) * clamp01(duck);
}

/** The loudness the music element actually plays at for a slider value:
 *  the same curve as webBackend.setVolume (power 1.5, linear in party mode). */
export function elementLevel(volume: number, muted: boolean, party: boolean): number {
  if (muted) return 0;
  const v = clamp01(volume);
  return party ? v : Math.pow(v, 1.5);
}

/** The sound's own element volume: the admin's 0.1..1 share of what the
 *  person hears from their music, so a prank is never louder than their own
 *  setting (and silent when they have muted). */
export function overlayLevel(prankVolume: number, volume: number, muted: boolean, party: boolean): number {
  return clamp01(prankVolume) * elementLevel(volume, muted, party);
}
