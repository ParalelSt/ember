import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents } from '@/lib/playback/types';
import type { CastMedia, CastRemote, CastRemoteStatus } from '@/lib/playback/castBackend';

// Casting from a browser, end to end in the provider: the song moves to the
// TV where it was, the queue keeps going there (next, loop), the volume
// slider drives the TV, the stopped local engine can no longer move the
// player, and the song comes back paused where the TV left it.

vi.mock('@/lib/api', () => ({ api: { getTrackGain: async () => ({ gainDb: null }) }, apiUrl: (u: string) => u }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => 'web' }));
const web = makeFakeBackend();
let webEvents: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (ev: AudioBackendEvents) => {
    webEvents = ev;
    return web;
  },
}));
vi.mock('@/lib/cast/controller', () => ({ initCast: vi.fn(), setCastMediaElement: vi.fn() }));
const resolveCastMedia = vi.fn(async (t: { id: string; title: string; artist: string }): Promise<CastMedia> => ({
  url: `https://ember.example/s/${t.id}?st=x`, contentType: 'audio/mp4', title: t.title, artist: t.artist, album: null, artworkUrl: null,
}));
const clearCastSignCache = vi.fn();
vi.mock('@/lib/cast/signer', () => ({ resolveCastMedia: (t: never) => resolveCastMedia(t), clearCastSignCache: () => clearCastSignCache() }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => null }));

const { castSessionStarted, castSessionEnded, _resetCastSession } = await import('@/lib/cast/session');

function fakeRemote(initial: Partial<CastRemoteStatus> = {}) {
  let status: CastRemoteStatus = { state: 'idle', time: 0, duration: 0, idleReason: null, ...initial };
  const subs = new Set<(s: CastRemoteStatus) => void>();
  return {
    load: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    status: () => status,
    subscribe(cb: (s: CastRemoteStatus) => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit(patch: Partial<CastRemoteStatus>) {
      status = { ...status, ...patch };
      for (const cb of subs) cb(status);
    },
  } satisfies CastRemote & { emit: unknown };
}

const A = makeTrack({ id: 'youtube:aaaaaaaaaaa', sourceId: 'aaaaaaaaaaa', title: 'A', streamUrl: '/s/a', durationSec: 200 });
const B = makeTrack({ id: 'youtube:bbbbbbbbbbb', sourceId: 'bbbbbbbbbbb', title: 'B', streamUrl: '/s/b', durationSec: 180 });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let controls: ReturnType<typeof usePlayer> | null = null;
const keep = (p: ReturnType<typeof usePlayer>) => { controls = p; };
function Grab() {
  const p = usePlayer();
  useEffect(() => keep(p));
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetCastSession();
  webEvents = null;
  controls = null;
  web.currentTime = 0;
  web.paused = true;
  usePlayerStore.setState({ queue: [A, B], index: 0, position: 0, isPlaying: false, duration: 0, volume: 0.8, muted: false, loopMode: 'off', context: null });
});

async function startPlayingAt(sec: number) {
  render(<PlayerProvider><Grab /></PlayerProvider>);
  act(() => controls!.playTrack(A, [A, B]));
  web.paused = false;
  web.currentTime = sec;
  act(() => webEvents!.onPlay());
  expect(usePlayerStore.getState().isPlaying).toBe(true);
  web.load.mockClear();
}

describe('PlayerProvider: casting', () => {
  it('moves the playing song to the TV from where it was, and stops it here', async () => {
    await startPlayingAt(42);
    const remote = fakeRemote();
    act(() => castSessionStarted(remote, 'Living Room TV'));
    await flush();
    expect(web.stop).toHaveBeenCalled();
    expect(resolveCastMedia).toHaveBeenCalledWith(A);
    expect(remote.load).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining(A.id) }), { startAt: 42, autoplay: true });
    // The slider's level, as the device's volume.
    expect(remote.setVolume).toHaveBeenCalled();
    expect(remote.setVolume.mock.calls.at(-1)![0]).toBeGreaterThan(0);
    expect(controls!.canSetRate).toBe(false);
  });

  it('the stopped local engine can no longer move the player', async () => {
    await startPlayingAt(10);
    const remote = fakeRemote();
    act(() => castSessionStarted(remote, 'TV'));
    await flush();
    act(() => remote.emit({ state: 'playing', time: 11, duration: 200 }));
    act(() => {
      webEvents!.onPause();
      webEvents!.onError();
      webEvents!.onEnded();
    });
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().index).toBe(0);
  });

  it('the queue goes on on the TV: a finished song plays the next one there', async () => {
    await startPlayingAt(0);
    const remote = fakeRemote();
    act(() => castSessionStarted(remote, 'TV'));
    await flush();
    act(() => remote.emit({ state: 'playing', time: 199, duration: 200 }));
    act(() => remote.emit({ state: 'idle', time: 0, idleReason: 'finished' }));
    await flush();
    expect(usePlayerStore.getState().index).toBe(1);
    expect(remote.load).toHaveBeenLastCalledWith(expect.objectContaining({ url: expect.stringContaining(B.id) }), { startAt: 0, autoplay: true });
    expect(web.load).not.toHaveBeenCalled();
  });

  it('a song picked while casting plays on the TV', async () => {
    await startPlayingAt(0);
    const remote = fakeRemote();
    act(() => castSessionStarted(remote, 'TV'));
    await flush();
    act(() => controls!.playTrack(B, [A, B]));
    await flush();
    expect(remote.load).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'B' }), { startAt: 0, autoplay: true });
    expect(web.load).not.toHaveBeenCalled();
  });

  it('the volume slider sets the TV\'s volume, and pause/seek go there too', async () => {
    await startPlayingAt(0);
    const remote = fakeRemote();
    act(() => castSessionStarted(remote, 'TV'));
    await flush();
    const before = remote.setVolume.mock.calls.length;
    act(() => controls!.setVolume(0.3));
    expect(remote.setVolume.mock.calls.length).toBeGreaterThan(before);
    const low = remote.setVolume.mock.calls.at(-1)![0];
    act(() => controls!.setVolume(0.7));
    expect(remote.setVolume.mock.calls.at(-1)![0]).toBeGreaterThan(low);
    act(() => usePlayerStore.getState().toggleMuted());
    expect(remote.setVolume.mock.calls.at(-1)![0]).toBe(0);
    act(() => controls!.seek(77));
    expect(remote.seek).toHaveBeenCalledWith(77);
    act(() => remote.emit({ state: 'playing', time: 77 }));
    act(() => controls!.toggle());
    expect(remote.pause).toHaveBeenCalled();
  });

  it('when casting stops, the song comes back here paused where the TV was', async () => {
    await startPlayingAt(5);
    const remote = fakeRemote();
    act(() => castSessionStarted(remote, 'TV'));
    await flush();
    act(() => remote.emit({ state: 'playing', time: 95, duration: 200 }));
    web.load.mockClear();
    act(() => castSessionEnded());
    expect(web.load).toHaveBeenCalledWith('/s/a', expect.objectContaining({ autoplay: false, startAt: 95 }));
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    // Links were signed for whoever cast: gone with the session.
    expect(clearCastSignCache).toHaveBeenCalled();
    // The local engine counts again.
    act(() => webEvents!.onPlay());
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(web.setVolume).toHaveBeenCalled();
  });

  it('a session joined after a reload follows the TV instead of restarting it', async () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    const remote = fakeRemote({ state: 'playing', time: 120, duration: 200, contentId: 'https://ember.example/api/youtube/stream/aaaaaaaaaaa?st=x' });
    act(() => castSessionStarted(remote, 'TV', true));
    await flush();
    expect(remote.load).toHaveBeenCalledWith(expect.anything(), { startAt: 120, autoplay: true });
  });

  it('a session that started before the player was ready is picked up', async () => {
    const remote = fakeRemote();
    castSessionStarted(remote, 'TV');
    render(<PlayerProvider><Grab /></PlayerProvider>);
    await flush();
    expect(remote.load).toHaveBeenCalled();
  });
});
