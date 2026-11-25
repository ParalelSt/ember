/** The player's shuffle buttons are real on/off toggles, with the real
 *  provider running (its effects must not turn shuffle back on or re-deal). */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { getRecommended: vi.fn().mockResolvedValue({ tracks: [] }) }, apiUrl: (u: string) => u }));
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
const LIST = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(mk);
const CTX = { type: 'playlist', playlistId: 'p1', playlistName: 'P' } as const;
const ORIGINAL = LIST.map((t) => t.id);

let controls: ReturnType<typeof usePlayer> | null = null;
let page: ReturnType<typeof useCollectionPlayback> | null = null;
function Grab() { controls = usePlayer(); page = useCollectionPlayback(LIST, CTX); return null; }
const ids = () => usePlayerStore.getState().queue.map((t) => t.id);
const st = () => usePlayerStore.getState();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  engines.web = [];
  usePlayerStore.setState({
    queue: [], index: 0, position: 0, isPlaying: false, duration: 200,
    context: null, loopMode: 'off', baseCount: 0, shuffle: false, orderBackup: null, radioHeldFor: null,
  });
});

describe('player shuffle toggle with the real provider', () => {
  it('on then off from the player: original order back around the playing song, flag off, and it stays off', async () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(LIST[2], LIST, CTX));
    await flush();
    act(() => st().toggleShuffle());
    await flush();
    expect(st().shuffle).toBe(true);
    act(() => st().toggleShuffle());
    await flush();
    expect(st().shuffle).toBe(false);
    expect(ids()).toEqual(ORIGINAL);
    expect(st().queue[st().index].id).toBe(LIST[2].id);
    expect(st().orderBackup).toBeNull();
  });

  it('the page button is the same toggle: on, off (original order), on again, then the player toggle off', async () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => controls!.playTrack(LIST[2], LIST, CTX));
    await flush();
    act(() => page!.shuffle());
    await flush();
    expect(st().shuffle).toBe(true);
    expect(st().queue[st().index].id).toBe(LIST[2].id);
    act(() => page!.shuffle());
    await flush();
    expect(st().shuffle).toBe(false);
    expect(ids()).toEqual(ORIGINAL);
    act(() => page!.shuffle());
    await flush();
    expect(st().shuffle).toBe(true);
    const playing = st().queue[st().index].id;
    act(() => st().toggleShuffle());
    await flush();
    expect(st().shuffle).toBe(false);
    expect(ids()).toEqual(ORIGINAL);
    expect(st().queue[st().index].id).toBe(playing);
    act(() => controls!.next());
    await flush();
    const i = ORIGINAL.indexOf(playing);
    expect(st().queue[st().index].id).toBe(ORIGINAL[(i + 1) % ORIGINAL.length]);
    expect(st().shuffle).toBe(false);
  });

  it('a fresh Shuffle play from nothing playing, then the player toggle off', async () => {
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => page!.shuffle());
    await flush();
    expect(st().shuffle).toBe(true);
    const playing = st().queue[st().index].id;
    act(() => st().toggleShuffle());
    await flush();
    expect(st().shuffle).toBe(false);
    expect(ids()).toEqual(ORIGINAL);
    expect(st().queue[st().index].id).toBe(playing);
  });
});
