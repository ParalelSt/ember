/** Previous follows what was actually played (lib/playback/queueNav, "Play
 *  history"). Reported on Android 0.7.15: "when tapping on a song in an auto
 *  generated queue, the previous song button leads you to a song previous on
 *  the list in the queue but not the previous song you actually played".
 *  These cover the web and desktop players; the Android player's own copy
 *  of the rule is tested in PlayHistoryTest.kt. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
vi.mock('@/lib/playback/nativeBridge', () => ({
  createNativeBackend: vi.fn(),
  nativeBackendReady: () => true,
}));

function engine(): FakeBackend {
  const b = makeFakeBackend();
  b.load = vi.fn((_url: string, opts: LoadOptions) => {
    if (opts.autoplay) b.play();
  });
  return b;
}
const engines = vi.hoisted(() => ({ native: null as unknown, web: [] as unknown[] }));
let webEvents: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/tauriBackend', () => ({
  createTauriBackend: () => engines.native,
}));
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (e: AudioBackendEvents) => {
    webEvents = e;
    const b = engine();
    engines.web.push(b);
    return b;
  },
}));

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
const probe = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => probe }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', streamUrl: '/s/a', durationSec: 200 });
const B = makeTrack({ id: 'youtube:b', sourceId: 'b', streamUrl: '/s/b', durationSec: 200 });
const C = makeTrack({ id: 'youtube:c', sourceId: 'c', streamUrl: '/s/c', durationSec: 200 });
const D = makeTrack({ id: 'youtube:d', sourceId: 'd', streamUrl: '/s/d', durationSec: 200 });

let controls: ReturnType<typeof usePlayer> | null = null;
const keep = (c: ReturnType<typeof usePlayer>) => {
  controls = c;
};
function Grab() {
  keep(usePlayer());
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  shell.kind = 'web';
  engines.native = engine();
  engines.web = [];
  webEvents = null;
  controls = null;
  usePlayerStore.setState({
    queue: [A, B, C, D], index: 0, position: 0, isPlaying: false, duration: 200,
    context: null, loopMode: 'off', baseCount: 4, shuffle: false, orderBackup: null,
  });
});

const web = () => engines.web[engines.web.length - 1] as FakeBackend;

const E = makeTrack({ id: 'youtube:e', sourceId: 'e', streamUrl: '/s/e', durationSec: 200 });
const ids = () => usePlayerStore.getState().queue.map((t) => t.id);
const at = () => usePlayerStore.getState().index;

describe('Previous after a tap in the queue', () => {
  it('goes back to the song played before the tap, not the one above', () => {
    usePlayerStore.setState({ context: { type: 'radio' }, baseCount: 1 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(3));
    expect(at()).toBe(3);
    web().load.mockClear();
    act(() => controls!.prev());
    expect(at()).toBe(0);
    expect(web().load.mock.calls.map((c) => c[0])).toEqual(['/s/a']);
    // The queue itself is untouched: only the current song moved.
    expect(ids()).toEqual([A.id, B.id, C.id, D.id]);
  });

  it('still restarts the song past 3 s, and keeps the history for the next press', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(3));
    const w = web();
    w.currentTime = 10;
    w.seek.mockClear();
    act(() => controls!.prev());
    expect(w.seek).toHaveBeenCalledWith(0);
    expect(at()).toBe(3);
    w.currentTime = 0;
    act(() => controls!.prev());
    expect(at()).toBe(0);
  });

  it('walks back through several jumps, newest first, without bouncing', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(3)); // A -> D
    act(() => controls!.playAt(1)); // D -> B
    act(() => controls!.prev());
    expect(at()).toBe(3);
    act(() => controls!.prev());
    expect(at()).toBe(0);
    // Nothing before A: Previous at the top of the queue, early, stays put.
    act(() => controls!.prev());
    expect(at()).toBe(0);
  });

  it('counts a natural advance as played', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(2)); // A -> C
    const w = web();
    w.currentTime = 200;
    w.durationSec = 200;
    act(() => usePlayerStore.setState({ position: 200, duration: 200, isPlaying: true }));
    act(() => webEvents!.onEnded()); // C -> D
    expect(at()).toBe(3);
    w.currentTime = 0;
    act(() => controls!.prev());
    expect(at()).toBe(2);
    act(() => controls!.prev());
    expect(at()).toBe(0);
  });

  it('is unchanged for a playlist played in order: the song above', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => {
      controls!.next();
      controls!.next();
    });
    expect(at()).toBe(2);
    act(() => controls!.prev());
    expect(at()).toBe(1);
    act(() => controls!.prev());
    expect(at()).toBe(0);
  });

  it('falls back to the song above when nothing was played in this session', () => {
    usePlayerStore.setState({ index: 3 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.prev());
    expect(at()).toBe(2);
    act(() => controls!.prev());
    expect(at()).toBe(1);
  });

  it('treats a tap on another song of the list already playing as a jump', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(D, [A, B, C, D], { type: 'radio' }));
    expect(at()).toBe(3);
    act(() => controls!.prev());
    expect(at()).toBe(0);
  });

  it('starts a fresh history for a whole new queue', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(3)); // history: A
    // Another playlist with the same songs in another order, B tapped.
    act(() => controls!.playTrack(B, [C, A, D, B], { type: 'playlist', playlistId: 'p2', playlistName: 'Other' }));
    expect(ids()).toEqual([C.id, A.id, D.id, B.id]);
    expect(at()).toBe(3);
    act(() => controls!.prev());
    // The song above in the new list (D), not A from the old queue.
    expect(at()).toBe(2);
  });

  it('skips a remembered song that has since been removed from the queue', () => {
    usePlayerStore.setState({ queue: [A, B, C, D, E] });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(2)); // A -> C, history: A
    act(() => controls!.playAt(4)); // C -> E, history: A, C
    act(() => usePlayerStore.setState({ queue: [A, B, D, E], index: 3 }));
    act(() => controls!.prev());
    expect(usePlayerStore.getState().queue[at()].id).toBe(A.id);
  });
});
