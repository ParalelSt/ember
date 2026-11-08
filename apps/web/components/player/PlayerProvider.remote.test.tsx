import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useRemoteStore } from '@/stores/useRemoteStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import { buildSnapshot } from '@/lib/remote/snapshot';
import type { RemoteDevice, StateAnswer } from '@/lib/remote/types';

// Controlling another device, end to end in the provider (W6): the phone
// opens while Windows plays, attaches, mirrors Windows, and every control
// becomes a command; a move either way; a device that goes away gives the
// phone its own queue back. The local engine (web audio or the native
// Android player) stays stopped and is never handed the remote songs.

const shell = vi.hoisted(() => ({ value: 'web' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.value }));
const remoteApi = vi.hoisted(() => ({
  beat: vi.fn(async () => ({ now: Date.now(), commands: [], watchers: 0, active: null })),
  state: vi.fn(),
  command: vi.fn(async () => ({ id: 'c1' })),
}));
vi.mock('@/lib/api', () => ({ api: { remote: remoteApi, getTrackGain: async () => ({ gainDb: null }) }, apiUrl: (u: string) => u }));
vi.mock('@/lib/versions/device', () => ({ deviceId: () => 'phone-device-1', detectDevicePlatform: () => 'android' }));
const web = makeFakeBackend();
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend: () => web }));
const androidFake = makeFakeBackend();
const native = vi.hoisted(() => ({
  setQueue: vi.fn(), setLoop: vi.fn(), next: vi.fn(), prev: vi.fn(), back: vi.fn(), setNormalize: vi.fn(), setEq: vi.fn(), setShuffle: vi.fn(),
}));
vi.mock('@/lib/playback/androidBackend', () => ({
  androidPluginPresent: () => true,
  createAndroidBackend: () => Object.assign(androidFake, native),
}));
vi.mock('@/lib/cast/controller', () => ({ initCast: vi.fn(), setCastMediaElement: vi.fn() }));
vi.mock('@/lib/cast/signer', () => ({ resolveCastMedia: vi.fn(), clearCastSignCache: vi.fn() }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const recordPlay = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: recordPlay }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => null }));

const t = (k: string) => makeTrack({ id: `youtube:${k}`, sourceId: k, title: k.toUpperCase(), streamUrl: `/s/${k}`, durationSec: 200 });
const A = t('a');
const B = t('b');
const X = t('x');
const Y = t('y');
const Z = t('z');
const WIN = 'win-device-1';
const ME = 'phone-device-1';

/** What the server says about Windows: playing X (or `index`) from
 *  position 30 at `since`, its playhead running on. */
const remote = {
  playing: true,
  index: 0,
  since: 0,
  stale: false,
  present: true,
};
function windows(): RemoteDevice {
  const now = Date.now();
  const position = 30 + (remote.playing ? (now - remote.since) / 1000 : 0);
  return {
    deviceId: WIN, label: 'Windows', platform: 'windows', shell: 'tauri', lastBeat: now, stale: remote.stale,
    snapshot: {
      ...buildSnapshot({ queue: [X, Y, Z], index: remote.index, position, duration: 200, isPlaying: remote.playing, volume: 0.5, muted: false, loopMode: 'off', shuffle: false, context: { type: 'liked' } }),
      at: now, changedAt: remote.since,
    },
  };
}
let rev = 1;
const stateAnswer = (): StateAnswer => {
  const devices = remote.present ? [windows()] : [];
  return { now: Date.now(), rev: rev++, active: remote.present && !remote.stale ? WIN : null, devices };
};

let controls: ReturnType<typeof usePlayer> | null = null;
const keep = (p: ReturnType<typeof usePlayer>) => { controls = p; };
function Grab() {
  const p = usePlayer();
  useEffect(() => keep(p));
  return null;
}
const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const commands = () => remoteApi.command.mock.calls.map((c) => (c as unknown[])[2]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.clearAllMocks();
  shell.value = 'web';
  Object.assign(remote, { playing: true, index: 0, since: Date.now(), stale: false, present: true });
  remoteApi.state.mockImplementation(async () => stateAnswer());
  web.currentTime = 0;
  web.paused = true;
  controls = null;
  window.localStorage.clear();
  useSettingsStore.setState({ normalizeVolume: false, partyVolume: false });
  useRemoteStore.setState({ devices: [], active: null, rev: null, offset: 0, mode: 'local', target: null, dismissed: null });
  usePlayerStore.setState({ queue: [A, B], index: 1, position: 77, isPlaying: false, duration: 0, volume: 0.8, muted: false, loopMode: 'off', shuffle: false, orderBackup: null, context: { type: 'history' } });
});
afterEach(() => vi.useRealTimers());

async function openPhone() {
  render(<PlayerProvider><Grab /></PlayerProvider>);
  await tick(0);
}

describe('PlayerProvider: controlling another device', () => {
  it('attaching stops the local engine and shows the remote song and playhead', async () => {
    web.currentTime = 77;
    await openPhone();
    expect(useRemoteStore.getState()).toMatchObject({ mode: 'controlling', target: WIN });
    expect(web.stop).toHaveBeenCalled();
    // Only the paused cold-start load of the phone's own song, before the
    // answer came: nothing of Windows' plays here.
    expect(web.load.mock.calls.map((c) => c[0])).toEqual([B.streamUrl]);
    expect(web.load.mock.invocationCallOrder[0]).toBeLessThan(web.stop.mock.invocationCallOrder.at(-1)!);
    const st = usePlayerStore.getState();
    expect(st.queue.map((q) => q.id)).toEqual([X.id, Y.id, Z.id]);
    expect(st.index).toBe(0);
    expect(st.context).toEqual({ type: 'liked' });
    expect(st.isPlaying).toBe(true);
    expect(st.position).toBeCloseTo(30, 0);
    await tick(3000);
    expect(usePlayerStore.getState().position).toBeGreaterThan(32);
  });

  it('play, pause, next and seek become commands; the local queue is not touched', async () => {
    await openPhone();
    web.load.mockClear();
    act(() => controls!.toggle());
    expect(remoteApi.command).toHaveBeenLastCalledWith(WIN, ME, { type: 'pause' });
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    act(() => controls!.next());
    expect(remoteApi.command).toHaveBeenLastCalledWith(WIN, ME, { type: 'next' });
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe(X.id);
    act(() => controls!.seek(20));
    expect(remoteApi.command).toHaveBeenLastCalledWith(WIN, ME, { type: 'seek', args: { sec: 20 } });
    expect(web.load).not.toHaveBeenCalled();
    expect(web.play).not.toHaveBeenCalled();
  });

  it('a song tapped while controlling plays on the other device, and this one keeps controlling', async () => {
    await openPhone();
    web.load.mockClear();
    act(() => controls!.playTrack(B, [A, B], { type: 'playlist', playlistId: 'p', playlistName: 'Mix' }));
    const cmd = commands().at(-1) as { type: string; args: { tracks: { id: string }[]; index: number; play: boolean; context: unknown } };
    expect(cmd.type).toBe('setQueue');
    expect(cmd.args.tracks.map((q) => q.id)).toEqual([B.id]);
    expect(cmd.args).toMatchObject({ index: 0, play: true, context: { type: 'playlist', playlistId: 'p', playlistName: 'Mix' } });
    expect(useRemoteStore.getState().mode).toBe('controlling');
    expect(web.load).not.toHaveBeenCalled();
  });

  it('a tap in the queue sheet moves the other device within its own queue', async () => {
    remote.index = 1;
    await openPhone();
    act(() => controls!.playAt(1));
    expect(remoteApi.command).toHaveBeenLastCalledWith(WIN, ME, { type: 'playAt', args: { index: 2 } });
  });

  it('plays recorded on the other device are not recorded here', async () => {
    await openPhone();
    remote.index = 1;
    await tick(1500);
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe(Y.id);
    expect(recordPlay).not.toHaveBeenCalled();
  });

  it('moveTo sends the local queue cut at the current song and the local playhead, then controls', async () => {
    remote.present = false;
    await openPhone();
    expect(useRemoteStore.getState().mode).toBe('local');
    act(() => controls!.playTrack(A, [A, B]));
    web.currentTime = 42;
    web.paused = false;
    act(() => controls!.moveTo(WIN));
    const cmd = commands().at(-1) as { type: string; args: { tracks: { id: string }[]; index: number; play: boolean; startSec: number } };
    expect(cmd.type).toBe('setQueue');
    expect(cmd.args.tracks.map((q) => q.id)).toEqual([A.id, B.id]);
    expect(cmd.args).toMatchObject({ index: 0, play: true, startSec: 42 });
    expect(useRemoteStore.getState()).toMatchObject({ mode: 'controlling', target: WIN });
    expect(web.stop).toHaveBeenCalled();
  });

  it('moveHere pauses the other device and plays its song here, where its playhead is', async () => {
    await openPhone();
    await tick(2000);
    web.load.mockClear();
    act(() => controls!.moveHere());
    expect(remoteApi.command).toHaveBeenLastCalledWith(WIN, ME, { type: 'pause' });
    expect(useRemoteStore.getState().mode).toBe('local');
    expect(web.load).toHaveBeenCalledTimes(1);
    const [url, opts] = web.load.mock.calls[0];
    expect(url).toBe(X.streamUrl);
    expect(opts.autoplay).toBe(true);
    expect(opts.startAt).toBeGreaterThan(31);
    expect(opts.startAt).toBeLessThan(33);
    // The queue kept aside is dropped: the move adopted the other one.
    expect(usePlayerStore.getState().queue.map((q) => q.id)).toEqual([X.id, Y.id, Z.id]);
    // And this device does not go straight back to controlling it.
    await tick(3000);
    expect(useRemoteStore.getState().mode).toBe('local');
  });

  it('a device that goes away gives back the queue, index and playhead kept aside, paused', async () => {
    web.currentTime = 77;
    await openPhone();
    remote.stale = true;
    await tick(36_000);
    expect(useRemoteStore.getState().mode).toBe('local');
    const st = usePlayerStore.getState();
    expect(st.queue.map((q) => q.id)).toEqual([A.id, B.id]);
    expect(st.index).toBe(1);
    expect(st.context).toEqual({ type: 'history' });
    expect(st.isPlaying).toBe(false);
    expect(web.load).toHaveBeenLastCalledWith(B.streamUrl, expect.objectContaining({ autoplay: false, startAt: 77 }));
  });

  it('on Android, the native player is emptied and never handed the other device songs', async () => {
    shell.value = 'capacitor';
    await openPhone();
    expect(useRemoteStore.getState().mode).toBe('controlling');
    const afterAttach = native.setQueue.mock.calls.slice(-1)[0];
    expect(afterAttach).toEqual([[], 0, false]);
    native.setQueue.mockClear();
    act(() => controls!.playTrack(B, [A, B]));
    act(() => controls!.next());
    await tick(3000);
    expect(native.setQueue).not.toHaveBeenCalled();
    expect(native.next).not.toHaveBeenCalled();
    expect(commands().map((c) => (c as { type: string }).type)).toEqual(['setQueue', 'next']);
  });
});
