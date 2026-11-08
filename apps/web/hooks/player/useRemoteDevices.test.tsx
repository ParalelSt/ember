import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteDevices } from './useRemoteDevices';
import { POLL_CONTROLLING_MS } from '@/lib/remote/cadence';
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
  useRemoteStore.setState({ devices: [], active: null, rev: null, offset: 0, mode: 'local', target: null, dismissed: null });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

function setup(fetchState: (d: string, r: number | null) => Promise<StateAnswer>, localPlaying = false) {
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
    expect(fetchState).toHaveBeenCalledWith(ME, null);
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
    // The second call carries the rev it has.
    expect(fetchState).toHaveBeenLastCalledWith(ME, 1);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(POLL_CONTROLLING_MS * 5);
    expect(fetchState).toHaveBeenCalledTimes(3);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
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

  it('leaves remote mode once the device has been stale for 35 s', async () => {
    let stale = false;
    const fetchState = vi.fn(async () => answer([windows({ stale })], stale ? null : WIN));
    const { onDetach } = setup(fetchState);
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteStore.getState().mode).toBe('controlling');
    stale = true;
    await vi.advanceTimersByTimeAsync(STALE_MS - 2000);
    expect(onDetach).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(onDetach).toHaveBeenCalledTimes(1);
    expect(useRemoteStore.getState().mode).toBe('local');
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
});
