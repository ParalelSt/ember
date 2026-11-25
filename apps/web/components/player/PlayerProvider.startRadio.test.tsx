/** "Start radio": from a song in a list (Liked), the queue becomes that song
 *  plus radio's own recommendations, not the list. From the song already
 *  playing, it keeps playing without a reload. The real useRadioExtend runs;
 *  only the server's answer is faked. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

const getRecommended = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { getRecommended }, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => 'web' }));
vi.mock('@/lib/playback/nativeBridge', () => ({ createNativeBackend: vi.fn(), nativeBackendReady: () => true }));
const engines = vi.hoisted(() => ({ web: [] as unknown[] }));
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (_e: AudioBackendEvents) => {
    const b = makeFakeBackend();
    b.load = vi.fn((_url: string, opts: LoadOptions) => { if (opts.autoplay) b.play(); });
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
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));

const mk = (c: string) => makeTrack({ title: `Song ${c}`, artist: `Artist ${c}`, id: `youtube:${c}`, sourceId: c.padEnd(11, c), streamUrl: `/s/${c}`, durationSec: 200 });
const A = mk('a'), B = mk('b'), C = mk('c');
const R1 = mk('r'), R2 = mk('s');
const LIKED = { type: 'liked' } as const;

let controls: ReturnType<typeof usePlayer> | null = null;
function Grab() { controls = usePlayer(); return null; }
const web = () => engines.web[engines.web.length - 1] as FakeBackend;
const ids = () => usePlayerStore.getState().queue.map((t) => t.id);

beforeEach(() => {
  vi.clearAllMocks();
  engines.web = [];
  controls = null;
  getRecommended.mockResolvedValue({ tracks: [R1, R2] });
  usePlayerStore.setState({
    queue: [A, B, C], index: 0, position: 0, isPlaying: false, duration: 200,
    context: LIKED, loopMode: 'off', baseCount: 3, shuffle: false, orderBackup: null, radioHeldFor: null,
  });
});

describe('start radio', () => {
  it('on another song of the list: that song, then recommendations, not the list', async () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.startRadio(B));
    expect(ids()[0]).toBe(B.id);
    expect(usePlayerStore.getState().index).toBe(0);
    expect(usePlayerStore.getState().context).toEqual({ type: 'single' });
    await waitFor(() => expect(ids()).toEqual([B.id, R1.id, R2.id]));
    expect(getRecommended).toHaveBeenCalledWith(B.sourceId);
    expect(ids()).not.toContain(A.id);
    expect(ids()).not.toContain(C.id);
  });

  it('on the playing song: no reload, only what comes after is replaced', async () => {
    usePlayerStore.setState({ queue: [A, B, C], index: 1, shuffle: true, orderBackup: [A, B, C] });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    web().load.mockClear();
    act(() => controls!.startRadio(B));
    expect(web().load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState()).toMatchObject({ index: 0, baseCount: 1, shuffle: false, orderBackup: null });
    await waitFor(() => expect(ids()).toEqual([B.id, R1.id, R2.id]));
    expect(web().load).not.toHaveBeenCalled();
  });

  it('turns loop-all off so radio can extend', async () => {
    usePlayerStore.setState({ loopMode: 'all' });
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.startRadio(C));
    expect(usePlayerStore.getState().loopMode).toBe('off');
    await waitFor(() => expect(ids()).toEqual([C.id, R1.id, R2.id]));
  });
});
