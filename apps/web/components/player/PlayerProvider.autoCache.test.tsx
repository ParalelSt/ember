/** The player side of the auto cache: a cached copy plays instead of the
 *  stream, and offline the queue skips to songs with a local copy, stalls
 *  once (one toast, no retry loop) when there is none, and loads the song it
 *  stopped at, paused, when the connection returns. The cache adapter is a
 *  fake set straight into the store; useAutoCache (which would pick a real
 *  one) has its own tests. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OFFLINE_STALL_TOAST, PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents } from '@/lib/playback/types';
import type { CacheAdapter, CacheEntry } from '@/lib/autoCache/adapter';

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const engine = makeFakeBackend();
let events: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (e: AudioBackendEvents) => {
    events = e;
    return engine;
  },
}));

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
// The probe's offline branch, as the real one takes it (its own test covers
// the choice): the failed current track goes to the provider's handler.
vi.mock('@/hooks/player/useAvailabilityProbe', async () => {
  const { usePlayerStore: store } = await import('@/stores/usePlayerStore');
  return {
    useAvailabilityProbe: (_next: unknown, offlineRef: { current: ((t: { id: string }) => void) | null }) => () => {
      const st = store.getState();
      offlineRef.current?.(st.queue[st.index]);
    },
  };
});
vi.mock('@/hooks/player/useAutoCache', () => ({ useAutoCache: vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));

const up = (n: string) => makeTrack({ id: `upload:${n}`, source: 'upload', sourceId: n, title: `Song ${n}`, streamUrl: `/api/uploads/${n}/stream` });
const [A, B, C] = ['a', 'b', 'c'].map(up);

const cached = new Map<string, CacheEntry>();
const evict = vi.fn(async (ids: string[]) => { for (const id of ids) cached.delete(id); });
const fakeAdapter: CacheAdapter = {
  kind: 'opfs',
  writesThrough: false,
  ready: async () => true,
  has: (id) => cached.has(id),
  localSrcFor: (id) => (cached.has(id) ? `blob:cache/${id}` : null),
  prefetch: async () => ({ kind: 'failed' }),
  touch: () => {},
  evict,
  entries: () => cached,
  stats: () => ({ bytes: 0, count: cached.size, cap: 1 }),
  clear: async () => cached.clear(),
};

function Harness() {
  const { playTrack, next } = usePlayer();
  return (
    <>
      <button onClick={() => playTrack(A, [A, B, C], { type: 'playlist', id: 'p' } as never)}>play</button>
      <button onClick={next}>next</button>
    </>
  );
}

function setOnline(on: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
  act(() => useAutoCacheStore.getState().setOnline(on));
}

function mount() {
  render(<PlayerProvider><Harness /></PlayerProvider>);
  engine.load.mockClear();
}

beforeEach(() => {
  vi.clearAllMocks();
  cached.clear();
  events = null;
  engine.paused = true;
  // At the end of the song, so an `ended` reads as a finished song.
  engine.currentTime = 191;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  usePlayerStore.setState({ queue: [A, B, C], index: 0, position: 0, isPlaying: false, duration: 0, context: null, loopMode: 'off', baseCount: 3 });
  useOfflineStore.setState({ trackFiles: {}, webFiles: {} });
  useAutoCacheStore.setState({ adapter: fakeAdapter, supported: true, online: true, offlineStalled: false, stalledTrackId: null });
});

describe('an auto-cached copy', () => {
  it('plays instead of the stream, online too', () => {
    cached.set(A.id, { bytes: 1, lastUsedAt: 1 });
    mount();
    fireEvent.click(screen.getByText('play'));
    expect(engine.load).toHaveBeenLastCalledWith(`blob:cache/${A.id}`, expect.objectContaining({ autoplay: true, cacheKey: A.id }));
  });

  it('a pinned download still wins over it', () => {
    cached.set(A.id, { bytes: 1, lastUsedAt: 1 });
    useOfflineStore.setState({ webFiles: { [A.id]: 'blob:pinned/a' } });
    mount();
    fireEvent.click(screen.getByText('play'));
    expect(engine.load).toHaveBeenLastCalledWith('blob:pinned/a', expect.anything());
  });

  it('a copy that will not play is dropped from the cache and the song streams instead', () => {
    cached.set(A.id, { bytes: 1, lastUsedAt: 1 });
    mount();
    fireEvent.click(screen.getByText('play'));
    act(() => events!.onError());
    expect(evict).toHaveBeenCalledWith([A.id]);
    expect(engine.load).toHaveBeenLastCalledWith(A.streamUrl, expect.objectContaining({ autoplay: true }));
  });
});

describe('offline', () => {
  it('Next skips songs with no copy on this device', () => {
    cached.set(C.id, { bytes: 1, lastUsedAt: 1 });
    mount();
    setOnline(false);
    fireEvent.click(screen.getByText('next'));
    expect(engine.load).toHaveBeenLastCalledWith(`blob:cache/${C.id}`, expect.objectContaining({ autoplay: true }));
    expect(usePlayerStore.getState().index).toBe(2);
    // Skipped, not flagged: B is fine, just out of reach.
    expect(usePlayerStore.getState().queue[1].unavailableAt).toBeUndefined();
  });

  it('a pinned download counts as a local copy', () => {
    useOfflineStore.setState({ webFiles: { [B.id]: 'blob:pinned/b' } });
    mount();
    setOnline(false);
    fireEvent.click(screen.getByText('next'));
    expect(engine.load).toHaveBeenLastCalledWith('blob:pinned/b', expect.anything());
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('with nothing cached ahead, the end of a song stalls: one toast, no load, no loop', () => {
    mount();
    setOnline(false);
    engine.paused = true;
    act(() => events!.onEnded());
    act(() => events!.onEnded());

    expect(engine.load).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(OFFLINE_STALL_TOAST);
    expect(useAutoCacheStore.getState()).toMatchObject({ offlineStalled: true, stalledTrackId: B.id });
    expect(usePlayerStore.getState().index).toBe(0);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('Next pressed mid-song with nothing cached ahead: the song carries on, no stall', () => {
    mount();
    setOnline(false);
    engine.paused = false;
    fireEvent.click(screen.getByText('next'));
    expect(toast).toHaveBeenCalledWith(OFFLINE_STALL_TOAST);
    expect(useAutoCacheStore.getState().offlineStalled).toBe(false);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(engine.load).not.toHaveBeenCalled();
  });

  it('back online: the stall clears and the song it stopped at loads, paused', () => {
    mount();
    setOnline(false);
    act(() => events!.onEnded());
    engine.load.mockClear();

    setOnline(true);
    expect(useAutoCacheStore.getState().offlineStalled).toBe(false);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenLastCalledWith(B.streamUrl, expect.objectContaining({ autoplay: false }));
    expect(usePlayerStore.getState().index).toBe(1);
    expect(toast).toHaveBeenCalledWith('Back online', expect.anything());
  });

  it('a new offline spell gets its own toast', () => {
    mount();
    setOnline(false);
    act(() => events!.onEnded());
    setOnline(true);
    toast.mockClear();
    usePlayerStore.setState({ index: 1 });
    setOnline(false);
    act(() => events!.onEnded());
    expect(toast).toHaveBeenCalledWith(OFFLINE_STALL_TOAST);
  });

  it('the last song ending offline stalls too (radio cannot extend the queue)', () => {
    usePlayerStore.setState({ index: 2 });
    mount();
    setOnline(false);
    act(() => events!.onEnded());
    expect(useAutoCacheStore.getState()).toMatchObject({ offlineStalled: true, stalledTrackId: null });
    expect(toast).toHaveBeenCalledWith(OFFLINE_STALL_TOAST);
  });

  it('a song that fails offline moves on to the next local copy', () => {
    cached.set(C.id, { bytes: 1, lastUsedAt: 1 });
    mount();
    setOnline(false);
    act(() => events!.onError());
    expect(engine.load).toHaveBeenLastCalledWith(`blob:cache/${C.id}`, expect.objectContaining({ autoplay: true }));
    expect(usePlayerStore.getState().index).toBe(2);
  });

  it('a song that fails offline with nothing ahead stalls on itself, and loads again when back online', () => {
    usePlayerStore.setState({ index: 2 });
    mount();
    setOnline(false);
    act(() => events!.onError());
    expect(useAutoCacheStore.getState()).toMatchObject({ offlineStalled: true, stalledTrackId: C.id });
    engine.load.mockClear();
    setOnline(true);
    expect(engine.load).toHaveBeenLastCalledWith(C.streamUrl, expect.objectContaining({ autoplay: false }));
  });
});
