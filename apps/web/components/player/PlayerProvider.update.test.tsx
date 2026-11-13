/** An update the listener tapped while a song played goes in only in the
 *  gap after that song (lib/update/apply.ts), and the song that comes next
 *  starts by itself once the page is back. The owner's rule: an update
 *  never cuts a song off. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';
import { resetUpdateForTests, setApplyDepsForTests } from '@/lib/update/apply';
import { INITIAL_UPDATE_STATE, useUpdateStore } from '@/stores/useUpdateStore';

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

const reload = vi.hoisted(() => vi.fn());
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
  resetUpdateForTests();
  setApplyDepsForTests({ reload, restartShell: async () => true });
  useUpdateStore.setState({ ...INITIAL_UPDATE_STATE });
  shell.kind = 'web';
  engines.native = engine();
  engines.web = [];
  webEvents = null;
  controls = null;
  usePlayerStore.setState({
    queue: [A, B, C, D], index: 0, position: 0, isPlaying: false, duration: 200,
    context: null, loopMode: 'off', baseCount: 4, shuffle: false, orderBackup: null,
    played: [],
  });
});

const web = () => engines.web[engines.web.length - 1] as FakeBackend;
const at = () => usePlayerStore.getState().index;

function waitingUpdate() {
  useUpdateStore.getState().set({ status: 'available', offer: { kind: 'web', version: '0.7.44', canApply: true, via: 'reload' }, pending: true });
}

function endSong(w: FakeBackend) {
  w.currentTime = 200;
  w.durationSec = 200;
  act(() => usePlayerStore.setState({ position: 200, duration: 200, isPlaying: true }));
  act(() => webEvents!.onEnded());
}

describe('an update waiting for the song to end', () => {
  it('goes in at the end of the song, loads nothing, and notes the next song', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(1)); // B playing
    const w = web();
    waitingUpdate();
    w.load.mockClear();
    endSong(w);
    expect(reload).toHaveBeenCalledTimes(1);
    // The next song did not start under the reload.
    expect(w.load).not.toHaveBeenCalled();
    expect(at()).toBe(1);
    expect(JSON.parse(localStorage.getItem('ember.update.resume')!)).toMatchObject({ index: 2, trackId: C.id });
  });

  it('without a waiting update, the next song plays as always', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playAt(1));
    endSong(web());
    expect(reload).not.toHaveBeenCalled();
    expect(at()).toBe(2);
  });

  it('back from the reload, the noted song starts by itself from its beginning', () => {
    localStorage.setItem('ember.update.resume', JSON.stringify({ index: 2, trackId: C.id, at: Date.now() }));
    usePlayerStore.setState({ index: 1, position: 199 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    expect(at()).toBe(2);
    const w = web();
    expect(w.load).toHaveBeenCalled();
    const [url, opts] = w.load.mock.calls[w.load.mock.calls.length - 1];
    expect(url).toBe('/s/c');
    expect(opts).toMatchObject({ autoplay: true });
    expect(localStorage.getItem('ember.update.resume')).toBeNull();
  });

  it('an ordinary start does not autoplay', () => {
    usePlayerStore.setState({ index: 1, position: 50 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    const w = web();
    const calls = w.load.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][1]).toMatchObject({ autoplay: false });
  });
});
