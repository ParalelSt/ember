import type { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchPage from './page';
import type { Track } from '@/types/track';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));

vi.mock('@/hooks/useVoiceSearch', () => ({
  useVoiceSearch: () => ({ supported: false, listening: false, toggle: vi.fn() }),
}));

// The menu (add-to-playlist + share) fetches on its own and is covered by
// its own tests; a page test only needs to know the slot is wired.
vi.mock('@/components/track/menus/TrackMenu', () => ({
  renderTrackMenu: () => null,
  TrackMenu: ({ track, onRemove, removeLabel }: { track: Track; onRemove?: () => void; removeLabel?: string }) => (
    <span>
      <button type="button">{`More for ${track.title}`}</button>
      {onRemove && <button type="button" onClick={onRemove}>{removeLabel}</button>}
    </span>
  ),
}));

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

const recents = vi.hoisted(() => ({
  tracks: [] as Track[],
  removeMutate: vi.fn(),
  addMutate: vi.fn(),
}));
vi.mock('@/hooks/useRecentSearches', () => ({
  useQueryRecentSearches: () => ({ data: recents.tracks }),
  useExecuteAddRecentSearch: () => ({ mutate: recents.addMutate }),
  useExecuteRemoveRecentSearch: () => ({ mutate: recents.removeMutate }),
}));

const api = vi.hoisted(() => ({ search: vi.fn() }));
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  recents.tracks = [];
  api.search.mockResolvedValue({ tracks: [] });
});

describe('SearchPage', () => {
  it('[bughunt W07] shows real tracks under Trending instead of an empty state', async () => {
    const track = makeTrack({ id: 'youtube:trend', sourceId: 'trend', title: 'Chart Topper' });
    api.search.mockResolvedValue({ tracks: [track] });
    renderPage();

    expect(screen.getByText('Trending')).toBeInTheDocument();
    expect(await screen.findByText('Chart Topper')).toBeInTheDocument();
  });

  it('shows the recent searches as compact TrackRows and removes one on request', async () => {
    const track = makeTrack();
    recents.tracks = [track];
    renderPage();

    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
    // No X of its own any more: Remove lives in the song's ... menu.
    expect(screen.queryByRole('button', { name: 'Remove "Midnight Drive" from recent searches' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More for Midnight Drive' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from recent searches' }));
    expect(recents.removeMutate).toHaveBeenCalledWith(track.id);
  });

  // O9: the recents row only played on a click of the whole row, a
  // mouse-only handler on a div that Tab never reaches.
  it('gives the recent-searches row a keyboard-reachable play button', () => {
    const track = makeTrack();
    recents.tracks = [track];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: `Play ${track.title}` }));
    expect(trackActions.onPlay).toHaveBeenCalledWith(track);
  });

  // The page's recents drifted from the overlay's: the song playing right
  // now still offered Play there, and pressing it started it over.
  it('the recent row of the song playing now pauses it instead of starting it over', () => {
    const track = makeTrack();
    recents.tracks = [track];
    trackActions.currentId = track.id;
    trackActions.isPlaying = true;
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: `Pause ${track.title}` }));
      expect(trackActions.onToggle).toHaveBeenCalledTimes(1);
      expect(trackActions.onPlay).not.toHaveBeenCalled();
    } finally {
      trackActions.currentId = null;
      trackActions.isPlaying = false;
    }
  });

  it('shows the rate-limit message instead of results when the search hook reports a 429', async () => {
    api.search.mockRejectedValue({ status: 429 });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'daft punk' },
    });

    expect(await screen.findByText('Searching too fast, one moment.')).toBeInTheDocument();
  });

  it('says the search failed when YouTube cannot be reached, instead of an empty list', async () => {
    api.search.mockImplementation((q: string) =>
      q ? Promise.reject(Object.assign(new Error('down'), { status: 502 })) : Promise.resolve({ tracks: [] }));
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'daft punk' },
    });

    expect(await screen.findByText("Search isn't working right now. Try again in a moment.")).toBeInTheDocument();
  });

  it('renders search results through TrackList once the query resolves', async () => {
    const track = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Wind' });
    // Distinct from the empty-query (trending) fetch, so the assertion below
    // can only be satisfied once the real "second wind" search resolves.
    api.search.mockImplementation((q: string) => Promise.resolve({ tracks: q === 'second wind' ? [track] : [] }));
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'second wind' },
    });

    expect(await screen.findByText('Second Wind')).toBeInTheDocument();
  });

  it('playing a result also saves it to recent searches', async () => {
    const track = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Wind' });
    api.search.mockImplementation((q: string) => Promise.resolve({ tracks: q === 'second wind' ? [track] : [] }));
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'second wind' },
    });

    const row = await screen.findByText('Second Wind');
    fireEvent.click(row);

    await waitFor(() => expect(recents.addMutate).toHaveBeenCalledWith(track));
    expect(trackActions.onPlay).toHaveBeenCalledWith(track, [track], { type: 'search', query: 'second wind' });
  });
});

describe('Search page, no results', () => {
  it('shows an icon, a title and the query, with no button and no bare "No tracks"', async () => {
    api.search.mockResolvedValue({ tracks: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SearchPage />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzqx' } });
    expect(await screen.findByRole('heading', { name: 'No results' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Nothing matched "zzqx"/)).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.queryByText('No tracks')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
