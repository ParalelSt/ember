import type { Track } from '@/types/track';

/** Whether the server has confirmed this track can no longer be streamed
 *  (removed / private / geo-blocked). Absent, null, or empty means available. */
export function isUnavailable(track: Pick<Track, 'unavailableAt'> | null | undefined): boolean {
  return !!track?.unavailableAt;
}

/** Walks the queue from `start` by `step` (+1/-1) looking for the first
 *  playable track, collecting the unavailable ones it passes over along the
 *  way. With `wrap`, a run off one end continues from the other and gives up
 *  after one full lap (so an all-dead queue reports every track exactly once
 *  rather than looping forever). `index: -1` when nothing playable is found;
 *  `start` outside the queue with `wrap` false also returns -1 immediately. */
export function nextPlayable(
  queue: Track[],
  start: number,
  step: 1 | -1,
  wrap: boolean,
): { index: number; skipped: Track[] } {
  const len = queue.length;
  const skipped: Track[] = [];
  if (len === 0) return { index: -1, skipped };
  if (!wrap && (start < 0 || start >= len)) return { index: -1, skipped };

  let i = ((start % len) + len) % len; // normalize a possibly out-of-range start when wrapping
  for (let steps = 0; steps < len; steps++) {
    const track = queue[i];
    if (!isUnavailable(track)) return { index: i, skipped };
    skipped.push(track);
    const nextI = i + step;
    if (!wrap && (nextI < 0 || nextI >= len)) break;
    i = ((nextI % len) + len) % len;
  }
  return { index: -1, skipped };
}
