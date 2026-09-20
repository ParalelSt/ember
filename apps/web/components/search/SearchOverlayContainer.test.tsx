import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SearchOverlayContainer } from './SearchOverlayContainer';
import { useUiStore } from '@/stores/useUiStore';
import type { Track } from '@/types/track';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// @base-ui's Dialog reaches the repo root's hoisted React 18 through its own
// node_modules copy (see BugReportDialog.test.tsx), so render a plain
// element for the chrome: this test is about the overlay's behavior, not
// base-ui's own portal/focus machinery.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

const online = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => online.value }));

vi.mock('@/hooks/useVoiceSearch', () => ({
  useVoiceSearch: () => ({ supported: false, listening: false, toggle: vi.fn() }),
}));

vi.mock('@/components/track/menus/TrackMenu', () => ({
  renderTrackMenu: () => null,
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

// A fetch that never resolves by default: proves opening and typing never
// wait on the network. api.search is swapped per-test where a real response
// is needed.
const api = vi.hoisted(() => ({ search: vi.fn<() => Promise<{ tracks: Track[] }>>() }));
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

function renderOverlay() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchOverlayContainer />
    </QueryClientProvider>,
  );
}

function neverResolves() {
  return new Promise<{ tracks: Track[] }>(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  api.search.mockImplementation(neverResolves);
  recents.tracks = [];
  trackActions.currentId = null;
  trackActions.isPlaying = false;
  online.value = true;
  useUiStore.setState({ searchOpen: true });
});

describe('SearchOverlayContainer', () => {
  it('opens and focuses the input even with the network completely down', async () => {
    api.search.mockImplementation(neverResolves);
    renderOverlay();

    const input = screen.getByPlaceholderText('What do you want to listen to?');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('keeps every keystroke while a request is in flight', async () => {
    renderOverlay();
    const input = screen.getByPlaceholderText('What do you want to listen to?');

    fireEvent.change(input, { target: { value: 'd' } });
    fireEvent.change(input, { target: { value: 'da' } });
    fireEvent.change(input, { target: { value: 'daf' } });
    fireEvent.change(input, { target: { value: 'daft' } });

    expect(input).toHaveValue('daft');
  });

  it('renders results through TrackList once the query resolves', async () => {
    const track = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Wind' });
    api.search.mockResolvedValue({ tracks: [track] });
    renderOverlay();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'second wind' },
    });

    expect(await screen.findByText('Second Wind')).toBeInTheDocument();
  });

  it('dismisses on Escape', () => {
    renderOverlay();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('dismisses on the close button', () => {
    renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('shows the offline line, and no error, when offline', () => {
    online.value = false;
    renderOverlay();

    expect(
      screen.getByText('No connection. This will run when you are back online.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Searching too fast, one moment.')).toBeNull();
  });

  it('shows recent searches when the box is empty', () => {
    recents.tracks = [makeTrack()];
    renderOverlay();

    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
  });

  // The search-row controls: both row shapes the overlay shows get the
  // trailing play/pause button and the ember title, off one player.
  it('gives the recents a trailing play button that plays that track', () => {
    recents.tracks = [makeTrack()];
    renderOverlay();

    const button = screen.getByRole('button', { name: 'Play Midnight Drive' });
    fireEvent.click(button);
    expect(trackActions.onPlay).toHaveBeenCalledTimes(1);
    expect(trackActions.onPlay.mock.calls[0][0]).toMatchObject({ id: 'youtube:a1' });
    expect(trackActions.onToggle).not.toHaveBeenCalled();
  });

  it('pauses and resumes the recents row that is the current song', () => {
    recents.tracks = [makeTrack()];
    trackActions.currentId = 'youtube:a1';
    trackActions.isPlaying = true;
    const { rerender } = renderOverlay();

    fireEvent.click(screen.getByRole('button', { name: 'Pause Midnight Drive' }));
    expect(trackActions.onToggle).toHaveBeenCalledTimes(1);
    expect(trackActions.onPlay).not.toHaveBeenCalled();
    expect(screen.getByTestId('track-row-title').className).toContain('text-ember');

    trackActions.isPlaying = false;
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SearchOverlayContainer />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Resume Midnight Drive' })).toBeInTheDocument();
    // Paused looks the same as playing apart from the icon: the title keeps
    // the accent and nothing else marks the row.
    expect(screen.getByTestId('track-row-title').className).toContain('text-ember');
  });

  it('gives the results a trailing play button and the ember title, no glyph', async () => {
    const track = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Wind' });
    trackActions.currentId = 'youtube:b2';
    trackActions.isPlaying = true;
    api.search.mockResolvedValue({ tracks: [track] });
    renderOverlay();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'second wind' },
    });

    expect(await screen.findByRole('button', { name: 'Pause Second Wind' })).toBeInTheDocument();
    const title = screen.getByTestId('track-row-title');
    expect(title.className).toContain('text-ember');
    expect(title.querySelector('svg')).toBeNull();
    // No leading play cell any more: the control is the trailing one.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

});
