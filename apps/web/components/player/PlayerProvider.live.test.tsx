/** Live radio stations in the player (lib/radio): a stream with no length.
 *  It is never a play in history, always starts at "now", an end is a
 *  broken stream (not "next station"), Previous always means the station
 *  before, nothing seeks in it, and the desktop's own engine hands it to web
 *  audio. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import { stationTrack } from '@/lib/radio/station';
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
const events = vi.hoisted(() => ({ current: null as AudioBackendEvents | null }));
vi.mock('@/lib/playback/tauriBackend', () => ({
  createTauriBackend: (e: AudioBackendEvents) => {
    events.current = e;
    return engines.native;
  },
}));
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (e: AudioBackendEvents) => {
    events.current = e;
    const b = engine();
    engines.web.push(b);
    return b;
  },
}));

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const recordPlay = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: recordPlay }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
const probe = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => probe }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => null }));

const station = (n: number) => stationTrack({ id: `00000000-0000-4000-8000-00000000000${n}`, name: `Station ${n}`, favicon: null });
const S1 = station(1);
const S2 = station(2);
const S3 = station(3);
const SONG = makeTrack({ id: 'youtube:a', sourceId: 'a', streamUrl: '/s/a', durationSec: 200 });

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
  events.current = null;
  controls = null;
  usePlayerStore.setState({
    queue: [], index: -1, position: 0, isPlaying: false, duration: 0,
    context: null, loopMode: 'off', baseCount: 0, shuffle: false, orderBackup: null, played: [],
  });
});

const web = () => engines.web[engines.web.length - 1] as FakeBackend;
const at = () => usePlayerStore.getState().index;
const list = [S1, S2, S3];
const ctx = { type: 'stations' as const, name: 'Nearby' };

describe('a live station in the player', () => {
  it('is never recorded as a play; a song still is', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(S1, list, ctx));
    act(() => controls!.next());
    expect(at()).toBe(1);
    expect(recordPlay).not.toHaveBeenCalled();
    act(() => controls!.playTrack(SONG, [SONG]));
    expect(recordPlay).toHaveBeenCalledWith(SONG);
  });

  it('plays the station through the host and starts at now, whatever playhead was stored for it', () => {
    usePlayerStore.setState({ queue: list, index: 0, position: 312 });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(S1, list, ctx));
    const [url, opts] = web().load.mock.calls[web().load.mock.calls.length - 1];
    expect(url).toBe(S1.streamUrl);
    expect(opts.startAt).toBe(0);
    expect(usePlayerStore.getState().context).toEqual(ctx);
  });

  it('a station that ends broke: the error path, not the next station', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(S1, list, ctx));
    web().currentTime = 600;
    act(() => events.current!.onEnded());
    expect(at()).toBe(0);
    expect(probe).toHaveBeenCalled();
  });

  it('Previous goes to the station before, however long this one has played', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(S2, list, ctx));
    web().currentTime = 900;
    web().seek.mockClear();
    act(() => controls!.prev());
    expect(at()).toBe(0);
    expect(web().seek).not.toHaveBeenCalled();
  });

  it('cannot be seeked', () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(S1, list, ctx));
    act(() => controls!.seek(30));
    expect(web().seek).not.toHaveBeenCalled();
  });

  it('on the desktop app, plays on web audio instead of the native engine', () => {
    shell.kind = 'tauri';
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(S1, list, ctx));
    expect((engines.native as FakeBackend).load).not.toHaveBeenCalled();
    expect(web().load).toHaveBeenCalledWith(S1.streamUrl, expect.objectContaining({ autoplay: true, startAt: 0 }));
  });
});
