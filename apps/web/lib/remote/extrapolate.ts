import type { Snapshot } from './types';

/** Where the remote playhead is now. `offset` is the server's clock minus
 *  this device's (every answer carries `now`), so no two devices' clocks
 *  ever need to agree. Stops at the song's end and does not move while
 *  paused. */
export function extrapolate(
  snapshot: Pick<Snapshot, 'position' | 'duration' | 'isPlaying' | 'at'>,
  nowLocal: number,
  offset: number,
): number {
  const ran = snapshot.isPlaying ? Math.max(0, (nowLocal + offset - snapshot.at) / 1000) : 0;
  const pos = Math.max(0, snapshot.position + ran);
  return snapshot.duration > 0 ? Math.min(pos, snapshot.duration) : pos;
}

/** The offset from one answer: its `now` against the middle of the
 *  request. */
export function clockOffset(serverNow: number, sentAt: number, receivedAt: number): number {
  return serverNow - (sentAt + receivedAt) / 2;
}
