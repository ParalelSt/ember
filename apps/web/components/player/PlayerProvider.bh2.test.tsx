/** Provider faults found in the second player bug hunt (2026-09-25).
 *
 *  P1: next/prev navigated from the queue and index of the last render, so two
 *      skips before React re-rendered (a guest session's batch of skip
 *      commands, media keys, a quick double press outside React) both landed
 *      on the same song.
 *  P4: after the desktop engine fell back to web audio, the new engine never
 *      got the OS transport commands, so media keys and the OS media widget
 *      did nothing for the rest of the session.
 *  P5: a natural end was taken for a failure when the catalog's length was
 *      more than 10% longer than the real file: "Couldn't load" and the queue
 *      stopped, on every such song.
 */
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
let nativeEvents: AudioBackendEvents | null = null;
let webEvents: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/tauriBackend', () => ({
  createTauriBackend: (e: AudioBackendEvents) => {
    nativeEvents = e;
    return engines.native;
  },
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
function Grab() {
  controls = usePlayer();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  shell.kind = 'web';
  engines.native = engine();
  engines.web = [];
  nativeEvents = null;
  webEvents = null;
  controls = null;
  usePlayerStore.setState({
    queue: [A, B, C, D], index: 0, position: 0, isPlaying: false, duration: 200,
    context: null, loopMode: 'off', baseCount: 4, shuffle: false, orderBackup: null,
  });
});

const web = () => engines.web[engines.web.length - 1] as FakeBackend;

describe('P1: two skips before a re-render', () => {
  it('next twice in one task moves two songs', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    const { next } = controls!;
    web().load.mockClear();
    act(() => {
      next();
      next();
    });
    expect(usePlayerStore.getState().index).toBe(2);
    expect(web().load.mock.calls.map((c) => c[0])).toEqual(['/s/b', '/s/c']);
  });

  it('prev twice in one task moves two songs back', () => {
    usePlayerStore.setState({ index: 3 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    const { prev } = controls!;
    act(() => {
      prev();
      prev();
    });
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('a queue change not yet rendered is navigated as it is now', () => {
    usePlayerStore.setState({ index: 3 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    const { next } = controls!;
    const E = makeTrack({ id: 'youtube:e', sourceId: 'e', streamUrl: '/s/e' });
    // Radio appends to the queue on the last song, and a skip lands in the
    // same task: the rendered queue still ends here, the real one does not.
    act(() => {
      usePlayerStore.setState((s) => ({ queue: [...s.queue, E] }));
      next();
    });
    expect(usePlayerStore.getState().index).toBe(4);
  });
});

describe('P4: the web-audio fallback keeps the OS transport buttons', () => {
  it('wires the remote commands to the new engine', () => {
    shell.kind = 'tauri';
    render(<PlayerProvider><Grab /></PlayerProvider>);
    expect((engines.native as FakeBackend).setRemoteCommands).toHaveBeenCalledTimes(1);
    act(() => nativeEvents!.onError());
    expect(engines.web).toHaveLength(1);
    const w = web();
    expect(w.setRemoteCommands).toHaveBeenCalled();
    // And they drive the player: Next from the media keys moves on.
    act(() => w.remote!.next());
    expect(usePlayerStore.getState().index).toBe(1);
  });
});

describe('P5: a real end with a catalog length longer than the file', () => {
  it('advances when the engine itself reached the end of its (shorter) file', () => {
    // The catalog says 240 s; the file the engine played is 200 s, too far
    // apart for chooseDuration to take the engine's figure.
    usePlayerStore.setState({ queue: [
      { ...A, durationSec: 240 }, B,
    ], index: 0, duration: 240 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    const w = web();
    w.durationSec = 200;
    w.currentTime = 200;
    act(() => usePlayerStore.setState({ position: 199.8, duration: 240, isPlaying: true }));
    w.load.mockClear();
    act(() => webEvents!.onEnded());
    expect(probe).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().index).toBe(1);
    expect(w.load.mock.calls.map((c) => c[0])).toEqual(['/s/b']);
  });

  it('still treats an end well short of the engine length as a failure', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    const w = web();
    w.durationSec = 200;
    w.currentTime = 80;
    act(() => usePlayerStore.setState({ position: 80, duration: 200, isPlaying: true }));
    act(() => webEvents!.onEnded());
    expect(probe).toHaveBeenCalled();
    expect(usePlayerStore.getState().index).toBe(0);
  });
});
