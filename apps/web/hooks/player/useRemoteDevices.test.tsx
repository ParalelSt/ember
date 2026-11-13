import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { FOLLOW_GRACE_MS, useRemoteDevices } from './useRemoteDevices';
import { POLL_CONTROLLING_MS, POLL_PICKER_MS } from '@/lib/remote/cadence';
import { buildSnapshot } from '@/lib/remote/snapshot';
import { STALE_MS, type RemoteDevice, type StateAnswer } from '@/lib/remote/types';
import { makeTrack } from '@/test-utils/fakeBackend';
import { useRemoteStore } from '@/stores/useRemoteStore';

// The controller's poll (W5): once on open, every 1.5 s while controlling
// and visible, nothing while hidden; attaches only when nothing plays here;
// a device that stays stale leaves remote mode.

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', streamUrl: '/s/a' });
const ME = 'phone-device-1';
const WIN = 'win-device-1';

const windows = (over: Partial<RemoteDevice> = {}): RemoteDevice => ({
  deviceId: WIN, label: 'Windows', platform: 'windows', shell: 'tauri', lastBeat: Date.now(), stale: false,
  snapshot: {
    ...buildSnapshot({ queue: [A], index: 0, position: 5, duration: 191, isPlaying: true, volume: 1, muted: false, loopMode: 'off', shuffle: false, context: null }),
    at: Date.now(), changedAt: Date.now(),
  },
  ...over,
});
const answer = (devices: RemoteDevice[], active: string | null = devices[0]?.deviceId ?? null, rev = 1): StateAnswer =>
  ({ now: Date.now(), rev, active, devices });

let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  useRemoteStore.setState({ devices: [], active: null, rev: null, offset: 0, mode: 'local', target: null, dismissed: null, pickerOpen: false, heardAt: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

function setup(fetchState: (d: string, r: number | null, c: string | null) => Promise<StateAnswer>, localPlaying = false) {
  const onAttach = vi.fn((id: string) => useRemoteStore.setState({ mode: 'controlling', target: id }));
  const onDetach = vi.fn(() => useRemoteStore.setState({ mode: 'local', target: null }));
  const hook = renderHook(() => useRemoteDevices({ enabled: true, me: ME, localPlaying: () => localPlaying, onAttach, onDetach, fetchState }));
  return { onAttach, onDetach, ...hook };
}

describe('useRemoteDevices', () => {
  it('an idle device asks once on open and attaches to the one playing', async () => {
    const fetchState = vi.fn(async () => answer([windows()]));
    const { onAttach } = setup(fetchState);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchState).toHaveBeenCalledWith(ME, null, null);
    expect(onAttach).toHaveBeenCalledWith(WIN);
    expect(useRemoteStore.getState().devices).toHaveLength(1);
  });

  it('polls every 1.5 s while controlling, and nothing while hidden', async () => {
    const fetchState = vi.fn(async () => answer([windows()]));
    setup(fetchState);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_CONTROLLING_MS * 2);
    expect(fetchState).toHaveBeenCalledTimes(3);
    // Later calls carry the rev it has, and say which device it controls
    // (nothing plays here meanwhile).
    expect(fetchState).toHaveBeenLastCalledWith(ME, 1, WIN);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(POLL_CONTROLLING_MS * 5);
    expect(fetchState).toHaveBeenCalledTimes(3);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchState).toHaveBeenCalledTimes(4);
  });

  it('asks at once when the picker opens, then every 3 s until it closes', async () => {
    const fetchState = vi.fn(async () => answer([windows()]));
    setup(fetchState, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchState).toHaveBeenCalledTimes(1);
    useRemoteStore.getState().set({ pickerOpen: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchState).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_PICKER_MS * 2);
    expect(fetchState).toHaveBeenCalledTimes(4);
    useRemoteStore.getState().set({ pickerOpen: false });
    await vi.advanceTimersByTimeAsync(POLL_PICKER_MS * 3);
    expect(fetchState).toHaveBeenCalledTimes(4);
  });

  it('a hidden page asks nothing at all', async () => {
    hidden = true;
    const fetchState = vi.fn(async () => answer([windows()]));
    setup(fetchState);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchState).not.toHaveBeenCalled();
  });

  it('does not attach while this device plays, nor to itself', async () => {
    const playing = vi.fn(async () => answer([windows()]));
    const a = setup(playing, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.onAttach).not.toHaveBeenCalled();
    // Idle in local mode: no more polls.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playing).toHaveBeenCalledTimes(1);
    a.unmount();
    const self = setup(vi.fn(async () => answer([windows()], ME)));
    await vi.advanceTimersByTimeAsync(0);
    expect(self.onAttach).not.toHaveBeenCalled();
  });

  it('leaves remote mode at the first answer that calls the device stale', async () => {
    let stale = false;
    const fetchState = vi.fn(async () => answer([windows({ stale })], stale ? null : WIN));
    const { onDetach } = setup(fetchState);
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteStore.getState().mode).toBe('controlling');
    stale = true;
    await vi.advanceTimersByTimeAsync(POLL_CONTROLLING_MS);
    expect(onDetach).toHaveBeenCalledTimes(1);
    expect(useRemoteStore.getState().mode).toBe('local');
  });

  it('a device missing from the answers (a host restart) gets 35 s before this one gives up', async () => {
    let present = true;
    const fetchState = vi.fn(async () => (present ? answer([windows()]) : answer([], null)));
    const { onDetach } = setup(fetchState);
    await vi.advanceTimersByTimeAsync(0);
    present = false;
    await vi.advanceTimersByTimeAsync(STALE_MS - 2000);
    expect(onDetach).not.toHaveBeenCalled();
    // Back within the grace: still controlling.
    present = true;
    await vi.advanceTimersByTimeAsync(POLL_CONTROLLING_MS);
    present = false;
    await vi.advanceTimersByTimeAsync(STALE_MS - 2000);
    expect(onDetach).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it('follows the music to a third device that started playing', async () => {
    const mac = windows({ deviceId: 'mac-device-1', label: 'macOS' });
    let devices = [windows()];
    let active = WIN;
    const fetchState = vi.fn(async () => answer(devices, active));
    setup(fetchState);
    await vi.advanceTimersByTimeAsync(0);
    devices = [windows(), mac];
    active = 'mac-device-1';
    await vi.advanceTimersByTimeAsync(POLL_CONTROLLING_MS);
    expect(useRemoteStore.getState().target).toBe('mac-device-1');
  });

  it('right after a move to another device, does not flip back to the one still playing', async () => {
    const mac = windows({ deviceId: 'mac-device-1', label: 'macOS' });
    // Windows keeps playing; macOS has not reported since the move.
    const fetchState = vi.fn(async () => answer([windows(), { ...mac, snapshot: { ...mac.snapshot!, at: 0, isPlaying: false } }], WIN));
    setup(fetchState);
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteStore.getState().target).toBe(WIN);
    act(() => useRemoteStore.getState().set({ target: 'mac-device-1' }));
    await vi.advanceTimersByTimeAsync(POLL_CONTROLLING_MS * 2);
    expect(useRemoteStore.getState().target).toBe('mac-device-1');
    // Still nothing from macOS after the grace: follow the music.
    await vi.advanceTimersByTimeAsync(FOLLOW_GRACE_MS);
    expect(useRemoteStore.getState().target).toBe(WIN);
  });
});

