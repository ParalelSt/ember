/** Which position a track should start at.
 *
 *  The stored playhead belongs to exactly ONE track. Handing it to a different
 *  track is how a new song came to start at the previous song's timestamp:
 *  a stream that 403s makes the native engine report an error, the player
 *  retries the track on web audio, and the retry picked up whatever position
 *  the store happened to hold, which was still the song before it.
 *
 *  Kept as a pure function so the rule can be tested without a browser, an
 *  audio device or a Tauri shell. */
export interface ResumeInput {
  /** The track about to load. */
  trackId: string;
  /** Track the stored position was last written for, if known. */
  positionOwnerId: string | null | undefined;
  /** The stored playhead. */
  storedPosition: number;
  /** An explicit position the caller wants (a fallback resuming the same
   *  track, say). `null` means "decide from the stored position". */
  requested?: number | null;
}

export function resumeStartAt({
  trackId,
  positionOwnerId,
  storedPosition,
  requested = null,
}: ResumeInput): number {
  if (requested !== null && requested !== undefined) return Math.max(0, requested);
  if (!positionOwnerId || positionOwnerId !== trackId) return 0;
  if (!Number.isFinite(storedPosition) || storedPosition < 0) return 0;
  return storedPosition;
}
