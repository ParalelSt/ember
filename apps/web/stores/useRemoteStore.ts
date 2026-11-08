'use client';

import { create } from 'zustand';
import type { LightDevice, RemoteDevice, Snapshot, StateAnswer } from '@/lib/remote/types';

/** The account's other devices as this one last heard (GET /api/remote/state),
 *  and whether this one is controlling another (lib/remote). Never
 *  persisted: a reload asks again. */
interface RemoteState {
  devices: RemoteDevice[];
  active: string | null;
  rev: number | null;
  /** The server's clock minus this device's (lib/remote/extrapolate). */
  offset: number;
  mode: 'local' | 'controlling';
  /** The device being controlled. */
  target: string | null;
  /** The device and play state this one left on purpose: not attached to
   *  again until that device's play state changes (lib/remote/attach). */
  dismissed: { deviceId: string; changedAt: number } | null;
  /** The output picker is open: its "Your devices" list is kept fresh. */
  pickerOpen: boolean;
  /** When the last answer came (this device's clock), for "Last seen". */
  heardAt: number;
  set: (patch: Partial<Omit<RemoteState, 'set'>>) => void;
}

export const useRemoteStore = create<RemoteState>()((set) => ({
  devices: [],
  active: null,
  rev: null,
  offset: 0,
  mode: 'local',
  target: null,
  dismissed: null,
  pickerOpen: false,
  heardAt: 0,
  set: (patch) => set(patch),
}));

/** The devices after an answer: a light answer only moves the playheads of
 *  the devices already known. */
export function mergeDevices(prev: RemoteDevice[], answer: StateAnswer): RemoteDevice[] {
  if (!answer.light) return answer.devices as RemoteDevice[];
  const moved = new Map((answer.devices as LightDevice[]).map((d) => [d.deviceId, d]));
  return prev.map((d) => {
    const m = moved.get(d.deviceId);
    if (!m || !d.snapshot) return d;
    if (d.snapshot.position === m.position && d.snapshot.isPlaying === m.isPlaying && d.snapshot.at === m.at) return d;
    return { ...d, snapshot: { ...d.snapshot, position: m.position, isPlaying: m.isPlaying, at: m.at } };
  });
}

export function remoteDevice(id: string | null): RemoteDevice | null {
  if (!id) return null;
  return useRemoteStore.getState().devices.find((d) => d.deviceId === id) ?? null;
}

/** The controlled device's snapshot, null when not controlling. */
export function targetSnapshot(): Snapshot | null {
  const st = useRemoteStore.getState();
  return st.mode === 'controlling' ? remoteDevice(st.target)?.snapshot ?? null : null;
}
