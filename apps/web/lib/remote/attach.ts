import type { RemoteDevice } from './types';

/** When a device starts controlling another on its own: an active device
 *  exists, it is not this one, and nothing plays here. A device playing
 *  locally stays local (it may list the other one). The id to control, or
 *  null. `dismissed`: the device and play state this one left on purpose
 *  (a move here): not attached to again until that device's play state
 *  changes. */
export function decideAttach(
  me: string,
  active: Pick<RemoteDevice, 'deviceId' | 'stale' | 'snapshot'> | null,
  localPlaying: boolean,
  dismissed: { deviceId: string; changedAt: number } | null = null,
): string | null {
  if (!active || active.deviceId === me || active.stale || localPlaying) return null;
  if (!active.snapshot?.track) return null;
  if (dismissed && dismissed.deviceId === active.deviceId && dismissed.changedAt === active.snapshot.changedAt) return null;
  return active.deviceId;
}
