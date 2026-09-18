import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import SearchPage from './page';
import { SearchOverlayContainer } from '@/components/search/SearchOverlayContainer';
import { useUiStore } from '@/stores/useUiStore';
import type { Track } from '@/types/track';

// Same query, same mocked response, rendered through both the page and the
// overlay: they share hooks/useSearchQuery.ts, so both must show the same
// result rows: proves the overlay didn't drift from the page it reuses.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// @base-ui's Dialog reaches the repo root's hoisted React 18 through its own
// node_modules copy (see BugReportDialog.test.tsx); the overlay's own chrome
// isn't what this test is about, only that its results match the page's.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));

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

vi.mock('@/hooks/useRecentSearches', () => ({
  useQueryRecentSearches: () => ({ data: [] }),
  useExecuteAddRecentSearch: () => ({ mutate: vi.fn() }),
  useExecuteRemoveRecentSearch: () => ({ mutate: vi.fn() }),
}));

const api = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

function makeTracks(): Track[] {
  return [
    {
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
    },
    {
      id: 'youtube:b2',
      source: 'youtube',
      sourceId: 'b2',
      title: 'Second Wind',
      artist: 'Long Runner',
      artistId: 'art2',
      album: 'Miles',
      albumId: 'alb2',
      durationSec: 210,
      artworkUrl: null,
      streamUrl: '',
    },
  ];
}

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// TrackRow (density="list", what TrackList uses) renders the title in a
// plain div (no heading role); this class is how it's found in both the
// page and the overlay without relying on a11y roles that don't exist here.
function resultTitles(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.truncate.text-sm.font-semibold')).map(
    (el) => el.textContent,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ searchOpen: true });
});

describe('search page vs. search overlay parity', () => {
  it('render the same result titles for the same query', async () => {
    api.search.mockResolvedValue({ tracks: makeTracks() });

    const page = renderWith(<SearchPage />);
    fireEvent.change(page.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'runner' },
    });
    expect(await page.findByText('Second Wind')).toBeInTheDocument();
    const pageTitles = resultTitles(page.container);
    page.unmount();

    const overlay = renderWith(<SearchOverlayContainer />);
    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'runner' },
    });
    expect(await overlay.findByText('Second Wind')).toBeInTheDocument();
    const overlayTitles = resultTitles(overlay.container);

    expect(overlayTitles).toEqual(pageTitles);
    expect(pageTitles).toEqual(['Midnight Drive', 'Second Wind']);
  });
});
