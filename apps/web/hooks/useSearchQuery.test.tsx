import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { failWhenNothingFound, SEARCH_RATE_LIMIT_RETRY_MS, useSearchQuery } from './useSearchQuery';
import type { SearchChunk } from '@/lib/search/types';
import type { Track } from '@/types/track';

vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));

vi.mock('@/hooks/useVoiceSearch', () => ({
  useVoiceSearch: () => ({ supported: false, listening: false, toggle: vi.fn() }),
}));

const toast = vi.hoisted(() => ({ message: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const shell = vi.hoisted(() => ({ value: 'web' as 'web' | 'capacitor' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.value }));

const trackActions = vi.hoisted(() => ({
  currentId: null as string | null,
  isPlaying: false,
  likedIds: new Set<string>(),
  onPlay: vi.fn(),
  onToggle: vi.fn(),
  onLike: vi.fn(),
  artworkSrcFor: vi.fn(() => null),
}));
vi.mock('@/hooks/useTrackActions', () => ({ useTrackActions: () => trackActions }));

const recents = vi.hoisted(() => ({ tracks: [] as Track[], removeMutate: vi.fn(), addMutate: vi.fn() }));
vi.mock('@/hooks/useRecentSearches', () => ({
  useQueryRecentSearches: () => ({ data: recents.tracks }),
  useExecuteAddRecentSearch: () => ({ mutate: recents.addMutate }),
  useExecuteRemoveRecentSearch: () => ({ mutate: recents.removeMutate }),
}));

// The UI reads the streamed search; here it streams whatever the one-shot
// `api.search` mock answers, as one chunk (what an older server sends).
const api = vi.hoisted(() => {
  const search = vi.fn();
  return {
    search,
    searchStream: async function* (q: string): AsyncGenerator<SearchChunk> {
      yield { type: 'legacy' as const, tracks: (await search(q)).tracks };
    },
  };
});
vi.mock('@/lib/api', () => ({ api }));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: 'art1',
    album: 'Night Shift',
    albumId: 'alb1',
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  recents.tracks = [];
  shell.value = 'web';
  api.search.mockResolvedValue({ tracks: [] });
});

describe('useSearchQuery: a search that fails', () => {
  it('asks again after a rate limit, so the message clears without retyping', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const track = makeTrack();
      api.search.mockImplementation(async (q: string) => {
        if (q === 'daft punk' && api.search.mock.calls.filter((c) => c[0] === 'daft punk').length === 1) {
          throw { status: 429 };
        }
        return { tracks: q ? [track] : [] };
      });
      const { result } = renderHook(() => useSearchQuery(), { wrapper });
      act(() => result.current.setQ('daft punk'));
      await waitFor(() => expect(result.current.rateLimited).toBe(true));

      await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_RATE_LIMIT_RETRY_MS + 100); });
      await waitFor(() => expect(result.current.rateLimited).toBe(false));
      expect(result.current.data).toEqual([track]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the search failed when the server could not search, rather than showing no results', async () => {
    api.search.mockImplementation(async (q: string) => {
      if (q) throw Object.assign(new Error("Couldn't reach YouTube"), { status: 502 });
      return { tracks: [] };
    });
    const { result } = renderHook(() => useSearchQuery(), { wrapper });
    act(() => result.current.setQ('daft punk'));
    await waitFor(() => expect(result.current.searchFailed).toBe(true));
    expect(result.current.rateLimited).toBe(false);
  });
});

describe('useSearchQuery', () => {
  it('[bughunt W07] fetches with an empty query too, so Trending has real tracks', async () => {
    const track = makeTrack({ id: 'youtube:trend', sourceId: 'trend', title: 'Chart Topper' });
    api.search.mockResolvedValue({ tracks: [track] });
    const { result } = renderHook(() => useSearchQuery(), { wrapper });

    await waitFor(() => expect(api.search).toHaveBeenCalledWith(''));
    await waitFor(() => expect(result.current.data).toEqual([track]));
  });

  it('debounces typing into debouncedQ, trimming whitespace', async () => {
    const { result } = renderHook(() => useSearchQuery(), { wrapper });

    act(() => result.current.setQ('  daft punk  '));
    expect(result.current.debouncedQ).toBe('');

    await waitFor(() => expect(result.current.debouncedQ).toBe('daft punk'));
  });

  it('surfaces the rate-limit message via rateLimited', async () => {
    api.search.mockRejectedValue({ status: 429 });
    const { result } = renderHook(() => useSearchQuery(), { wrapper });

    act(() => result.current.setQ('daft punk'));
    await waitFor(() => expect(result.current.rateLimited).toBe(true));
  });

  it('onPlay saves the track to recent searches and plays it', async () => {
    const track = makeTrack();
    const { result } = renderHook(() => useSearchQuery(), { wrapper });

    act(() => result.current.onPlay(track, [track], { type: 'search', query: 'midnight' }));

    expect(recents.addMutate).toHaveBeenCalledWith(track);
    expect(trackActions.onPlay).toHaveBeenCalledWith(track, [track], { type: 'search', query: 'midnight' });
  });

  it('mic without voice support suggests Chrome in a browser', () => {
    const { result } = renderHook(() => useSearchQuery(), { wrapper });
    act(() => result.current.onMicClick());
    expect(toast.message).toHaveBeenCalledExactlyOnceWith("Voice search isn't supported in this browser: try Chrome.");
  });

  it('mic without voice support asks for an app update inside a shell', () => {
    shell.value = 'capacitor';
    const { result } = renderHook(() => useSearchQuery(), { wrapper });
    act(() => result.current.onMicClick());
    expect(toast.message).toHaveBeenCalledExactlyOnceWith('Update the Ember app to use voice search.');
  });
});

describe('failWhenNothingFound', () => {
  async function run(chunks: SearchChunk[]) {
    const out: SearchChunk[] = [];
    async function* source() { yield* chunks; }
    for await (const c of failWhenNothingFound(source())) out.push(c);
    return out;
  }

  it('an error with nothing found throws its status', async () => {
    await expect(run([{ type: 'uploads', tracks: [] }, { type: 'error', status: 502, error: 'down' }])).rejects.toMatchObject({ status: 502, message: 'down' });
  });

  it('an error after uploads or artists arrived is swallowed: they stay on screen', async () => {
    const out = await run([{ type: 'uploads', tracks: [makeTrack()] }, { type: 'error', status: 502, error: 'down' }, { type: 'done' }]);
    expect(out.map((c) => c.type)).toEqual(['uploads', 'done']);
    const withArtists = await run([{ type: 'artists', artists: [{ id: 'UC1', name: 'A', artworkUrl: null }] }, { type: 'error', status: 502, error: 'x' }]);
    expect(withArtists.map((c) => c.type)).toEqual(['artists']);
  });
});

describe('useSearchQuery: streamed results', () => {
  /** A stream the test feeds one chunk at a time. */
  function controlledStream() {
    const waiting: ((c: SearchChunk | null) => void)[] = [];
    const queued: (SearchChunk | null)[] = [];
    const next = () => new Promise<SearchChunk | null>((resolve) => {
      const c = queued.shift();
      if (c !== undefined) resolve(c);
      else waiting.push(resolve);
    });
    const push = (c: SearchChunk | null) => {
      const w = waiting.shift();
      if (w) w(c);
      else queued.push(c);
    };
    async function* stream() {
      for (;;) {
        const c = await next();
        if (!c) return;
        yield c;
      }
    }
    return { push, stream };
  }

  it('the view grows as each group arrives, while still fetching', async () => {
    const original = api.searchStream;
    const feed = controlledStream();
    api.searchStream = (q: string) => (q ? feed.stream() : original(q));
    try {
      const { result } = renderHook(() => useSearchQuery(), { wrapper });
      act(() => result.current.setQ('wind'));
      await waitFor(() => expect(result.current.debouncedQ).toBe('wind'));

      act(() => feed.push({ type: 'uploads', tracks: [] }));
      act(() => feed.push({ type: 'artists', artists: [] }));
      act(() => feed.push({ type: 'songs', tracks: [makeTrack({ id: 'youtube:s1', title: 'Second Wind' })] }));
      await waitFor(() => expect(result.current.data.map((t) => t.id)).toEqual(['youtube:s1']));
      expect(result.current.isFetching).toBe(true);
      expect(result.current.hasResults).toBe(true);

      act(() => feed.push({ type: 'videos', tracks: [makeTrack({ id: 'youtube:v1', title: 'Wind live' })] }));
      await waitFor(() => expect(result.current.data.map((t) => t.id)).toEqual(['youtube:s1', 'youtube:v1']));
      act(() => feed.push({ type: 'done' }));
      act(() => feed.push(null));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
    } finally {
      api.searchStream = original;
    }
  });

  it('own matches (recent searches) come first, before the server answers', async () => {
    recents.tracks = [makeTrack({ id: 'youtube:r1', title: 'Necro Fantasia', artist: 'Demetori' })];
    const original = api.searchStream;
    api.searchStream = (q: string) => (q ? controlledStream().stream() : original(q));
    try {
      const { result } = renderHook(() => useSearchQuery(), { wrapper });
      act(() => result.current.setQ('demetori'));
      await waitFor(() => expect(result.current.data.map((t) => t.id)).toEqual(['youtube:r1']));
    } finally {
      api.searchStream = original;
    }
  });
});
