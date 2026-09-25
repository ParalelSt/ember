/** The provider driving the native Android player, which owns the queue and
 *  the loop mode. What is checked is what crosses the bridge: every setQueue
 *  and setLoop the provider sends, and what it mirrors from native.
 */
import { useEffect } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents } from '@/lib/playback/types';

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => 'capacitor' }));

const fake = makeFakeBackend();
const native = vi.hoisted(() => ({ setQueue: vi.fn(), setLoop: vi.fn(), next: vi.fn(), prev: vi.fn(), setNormalize: vi.fn() }));
let ev: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/androidBackend', () => ({
  androidPluginPresent: () => true,
  createAndroidBackend: (events: AudioBackendEvents) => {
    ev = events;
    return Object.assign(fake, native);
  },
}));

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

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', streamUrl: '/s/a', durationSec: 200 });
const B = makeTrack({ id: 'youtube:b', sourceId: 'b', streamUrl: '/s/b', durationSec: 200 });
const C = makeTrack({ id: 'youtube:c', sourceId: 'c', streamUrl: '/s/c', durationSec: 200 });
const D = makeTrack({ id: 'youtube:d', sourceId: 'd', streamUrl: '/s/d', durationSec: 200 });

let player: ReturnType<typeof usePlayer> | null = null;
const keep = (p: ReturnType<typeof usePlayer>) => { player = p; };
function Grab() {
  const p = usePlayer();
  useEffect(() => keep(p));
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  ev = null;
  usePlayerStore.setState({
    queue: [A, B], index: 0, position: 0, isPlaying: false, duration: 0,
    context: null, loopMode: 'off', shuffle: false, orderBackup: null,
  });
});

describe('android: the loop button', () => {
  it('tells the native player the loop mode at startup', () => {
    usePlayerStore.setState({ loopMode: 'all' });
    render(<PlayerProvider><div /></PlayerProvider>);
    expect(native.setLoop).toHaveBeenLastCalledWith('all');
  });

  it('every press of the loop button reaches the native player', () => {
    render(<PlayerProvider><div /></PlayerProvider>);
    native.setLoop.mockClear();
    act(() => { usePlayerStore.getState().cycleLoopMode(); });
    act(() => { usePlayerStore.getState().cycleLoopMode(); });
    act(() => { usePlayerStore.getState().cycleLoopMode(); });
    expect(native.setLoop.mock.calls).toEqual([['all'], ['one'], ['off']]);
  });

  it('a Repeat press in the car or notification shows on the loop button', () => {
    render(<PlayerProvider><div /></PlayerProvider>);
    act(() => { ev!.onLoopMode!('one'); });
    expect(usePlayerStore.getState().loopMode).toBe('one');
  });
});

describe('android: one setQueue per queue change', () => {
  it('tapping a song in a new list hands native that list once, not a one-song queue first', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    native.setQueue.mockClear();
    act(() => { player!.playTrack(C, [B, C, D], { type: 'album', id: 'x' } as never); });
    expect(native.setQueue.mock.calls).toEqual([[[B, C, D], 1, true, { context: { type: 'album', id: 'x' }, baseCount: 3 }]]);
  });

  it('that one send carries the new list\'s origin, not the old queue\'s (the auto cache wraps loop-all on it)', () => {
    usePlayerStore.setState({ context: { type: 'playlist', playlistId: 'old' } as never, baseCount: 40 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    native.setQueue.mockClear();
    act(() => { player!.playTrack(C, [B, C, D], { type: 'album', id: 'x' } as never); });
    const origin = native.setQueue.mock.calls[0][3];
    expect(origin).toEqual({ context: { type: 'album', id: 'x' }, baseCount: 3 });
    expect(usePlayerStore.getState().baseCount).toBe(3);
  });

  it('a search tap hands native the one song once', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    native.setQueue.mockClear();
    act(() => { player!.playTrack(C, [B, C, D], { type: 'search', query: 'c' } as never); });
    expect(native.setQueue.mock.calls).toEqual([[[C], 0, true, { context: { type: 'search', query: 'c' }, baseCount: 1 }]]);
  });

  it('shuffle hands native the new order once, same song at the same index', () => {
    usePlayerStore.setState({ queue: [A, B, C, D], index: 1, isPlaying: true });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    native.setQueue.mockClear();
    act(() => { usePlayerStore.getState().toggleShuffle(); });
    expect(native.setQueue).toHaveBeenCalledTimes(1);
    const [tracks, i, play] = native.setQueue.mock.calls[0];
    expect(tracks[i]).toBe(B);
    expect(i).toBe(1);
    expect(play).toBe(true);
  });

  it('removing another song hands native the shorter queue once', () => {
    usePlayerStore.setState({ queue: [A, B, C], index: 2, isPlaying: true });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    native.setQueue.mockClear();
    act(() => { usePlayerStore.setState({ queue: [B, C], index: 1 }); });
    expect(native.setQueue.mock.calls).toEqual([[[B, C], 1, true]]);
  });
});

describe('android: volume normalization', () => {
  it('hands native the setting at startup and on every change, and no per-song gain', () => {
    useSettingsStore.setState({ normalizeVolume: true });
    render(<PlayerProvider><div /></PlayerProvider>);
    expect(native.setNormalize).toHaveBeenLastCalledWith(true);
    act(() => { useSettingsStore.setState({ normalizeVolume: false }); });
    expect(native.setNormalize).toHaveBeenLastCalledWith(false);
    // Native applies the gain per song itself; setVolume carries none.
    for (const c of fake.setVolume.mock.calls) expect(c[1]?.normGain ?? 1).toBe(1);
  });
});

describe('android: a queue native built by itself', () => {
  it('native radio appended keeps the playlist it came from and the shuffle, with its way back', () => {
    usePlayerStore.setState({
      queue: [B, A], index: 1, context: { type: 'album', id: 'x' } as never,
      shuffle: true, orderBackup: [A, B],
    });
    render(<PlayerProvider><div /></PlayerProvider>);
    act(() => { ev!.onQueueReplaced!([B, A, C, D], 1); });
    const st = usePlayerStore.getState();
    expect(st.queue.map((t) => t.id)).toEqual([B.id, A.id, C.id, D.id]);
    expect(st.context).toEqual({ type: 'album', id: 'x' });
    expect(st.shuffle).toBe(true);
    // Unshuffle still restores the order, radio at the end.
    act(() => { usePlayerStore.getState().toggleShuffle(); });
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual([A.id, B.id, C.id, D.id]);
    expect(usePlayerStore.getState().index).toBe(0);
  });

  it('a new list from the car drops the playlist and the shuffle', () => {
    usePlayerStore.setState({ queue: [B, A], index: 0, shuffle: true, orderBackup: [A, B], context: { type: 'album', id: 'x' } as never });
    render(<PlayerProvider><div /></PlayerProvider>);
    act(() => { ev!.onQueueReplaced!([C, D], 0); });
    const st = usePlayerStore.getState();
    expect(st.queue.map((t) => t.id)).toEqual([C.id, D.id]);
    expect(st.context).toBeNull();
    expect(st.shuffle).toBe(false);
    expect(st.orderBackup).toBeNull();
  });
});
