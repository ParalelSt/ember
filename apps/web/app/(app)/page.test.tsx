import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import HomePage from './page';
import { toSummary } from '@/lib/collections';
import type { LiveCarlist, PlaybackContext, Track } from '@/types/track';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const state = vi.hoisted(() => ({
  focus: null as string | null,
  desktop: false,
  history: [] as Track[],
  liked: [] as Track[],
  trending: [] as Track[],
  recommended: [] as Track[],
  playlists: [] as ReturnType<typeof toSummary>[],
  carlist: null as LiveCarlist | null,
  context: null as PlaybackContext | null,
  current: null as Track | null,
  isPlaying: false,
  playTrack: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.focus ? `focus=${state.focus}` : ''),
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/components/OnlineOnly', () => ({ OnlineOnly: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: state.history }),
  useQueryLikes: () => ({ data: state.liked }),
  useQueryTrending: () => ({ data: state.trending, isLoading: false }),
  useQueryRecommended: () => ({ data: state.recommended, isLoading: false }),
}));
vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({
    system: [toSummary({ kind: 'liked' }, { count: state.liked.length })],
    playlists: state.playlists,
  }),
}));
vi.mock('@/hooks/useSession', () => ({ useQueryLiveCarlist: () => ({ data: state.carlist }) }));
vi.mock('@/stores/usePlayerStore', () => ({
  usePlayerStore: (sel: (s: { context: PlaybackContext | null }) => unknown) => sel({ context: state.context }),
}));
vi.mock('@/stores/useUiStore', () => ({
  useUiStore: (sel: (s: { lyricsOpen: boolean }) => unknown) => sel({ lyricsOpen: false }),
}));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ current: state.current, isPlaying: state.isPlaying, playTrack: state.playTrack, toggle: state.toggle }),
}));
// Its own tests cover the polling and the tiles; here it only has to land
// in the right place, in the right layout.
vi.mock('@/components/FriendsListening', () => ({
  FriendsListening: ({ layout }: { layout?: string }) => (
    <section aria-label="Friends are listening to" data-layout={layout ?? 'cards'}>
      <h2>Friends are listening to</h2>
    </section>
  ),
}));

function makeTracks(prefix: string, n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `youtube:${prefix}${i}`,
    source: 'youtube' as const,
    sourceId: `${prefix}${i}`,
    title: `${prefix} song ${i}`,
    artist: 'The Nulls',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 100,
    artworkUrl: null,
    streamUrl: '',
  }));
}

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    focus: null,
    desktop: false,
    history: makeTracks('hist', 4),
    liked: makeTracks('like', 3),
    trending: makeTracks('trend', 5),
    recommended: makeTracks('rec', 6),
    playlists: [
      toSummary({ kind: 'playlist', id: 'p1' }, { name: 'Road trip' }),
      toSummary({ kind: 'playlist', id: 'p2' }, { name: 'Gym' }),
    ],
    carlist: null,
    context: null,
    current: null,
    isPlaying: false,
  });
});

describe('Home on a phone', () => {
  it('has no big Home title, and starts with the quick grid of Liked songs and your playlists', () => {
    render(<HomePage />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    const grid = screen.getByRole('list', { name: 'Your collections' });
    const names = within(grid).getAllByRole('link').map((a) => a.textContent);
    expect(names).toEqual(['Liked songs', 'Road trip', 'Gym']);
    expect(within(grid).getByRole('link', { name: 'Liked songs' })).toHaveAttribute('href', '/library/liked');
    expect(within(grid).getByRole('link', { name: 'Road trip' })).toHaveAttribute('href', '/playlist/p1');
  });

  it('adds a live carlist to the quick grid and puts the playing playlist first', () => {
    state.carlist = { id: 's1', code: 'ABC123', name: 'Friday drive', isHost: false };
    state.context = { type: 'playlist', playlistId: 'p2', playlistName: 'Gym' };
    render(<HomePage />);
    const grid = screen.getByRole('list', { name: 'Your collections' });
    expect(within(grid).getAllByRole('link').map((a) => a.textContent)).toEqual(['Liked songs', 'Friday drive', 'Gym', 'Road trip']);
  });

  it('orders the rows like Spotify: Recently played, Your playlists, suggestions, likes, friends', () => {
    render(<HomePage />);
    expect(headings()).toEqual([
      'Recently played',
      'Your playlists',
      'Because you played "hist song 0"',
      'Trending right now',
      'From your liked songs',
      'Friends are listening to',
    ]);
    expect(screen.getByRole('region', { name: 'Friends are listening to' })).toHaveAttribute('data-layout', 'row');
  });

  it('hides empty rows', () => {
    Object.assign(state, { history: [], liked: [], trending: [], playlists: [] });
    render(<HomePage />);
    expect(headings()).toEqual(['Recommended for you', 'Friends are listening to']);
    // Liked songs stays in the quick grid even with no likes yet.
    expect(within(screen.getByRole('list', { name: 'Your collections' })).getAllByRole('link')).toHaveLength(1);
  });

  it('every row scrolls sideways', () => {
    render(<HomePage />);
    for (const name of ['Recently played', 'Your playlists', 'Trending right now', 'From your liked songs']) {
      const row = within(screen.getByRole('region', { name })).getByRole('list');
      expect(row).toHaveClass('flex', 'overflow-x-auto', 'snap-x');
      expect(row).not.toHaveClass('grid');
    }
  });

  it('links Show all to the focus view, and Your playlists to the Library', () => {
    render(<HomePage />);
    const showAll = (name: string) =>
      within(screen.getByRole('region', { name })).getByRole('link', { name: 'Show all' });
    expect(showAll('Recently played')).toHaveAttribute('href', '/?focus=history');
    expect(showAll('Trending right now')).toHaveAttribute('href', '/?focus=trending');
    expect(showAll('From your liked songs')).toHaveAttribute('href', '/?focus=liked');
    expect(showAll('Because you played "hist song 0"')).toHaveAttribute('href', '/?focus=recommended');
    expect(showAll('Your playlists')).toHaveAttribute('href', '/library');
  });

  it('a tap plays the track with its row as the list; a tap on the current track toggles', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByText('trend song 2'));
    expect(state.playTrack).toHaveBeenCalledWith(state.trending[2], state.trending);
    expect(state.toggle).not.toHaveBeenCalled();
  });

  it('marks the playing track and toggles it on a re-tap', () => {
    state.current = state.trending[1];
    state.isPlaying = true;
    render(<HomePage />);
    const title = screen.getByText('trend song 1');
    expect(title).toHaveClass('text-ember');
    fireEvent.click(title);
    expect(state.toggle).toHaveBeenCalledTimes(1);
    expect(state.playTrack).not.toHaveBeenCalled();
  });

  it('Show all opens the full grid of that row', () => {
    state.focus = 'history';
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Recently played' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your collections' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('Home on a desktop window', () => {
  it('keeps the title, the grid shelves and their order, with no quick grid', () => {
    state.desktop = true;
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your collections' })).toBeNull();
    expect(headings()).toEqual([
      'Friends are listening to',
      'Because you played "hist song 0"',
      'Trending right now',
      'From your liked songs',
      'Recently played',
    ]);
    expect(screen.getByRole('region', { name: 'Friends are listening to' })).toHaveAttribute('data-layout', 'cards');
    // The desktop shelves are grids, not sideways rows.
    const lists = screen.getAllByRole('list');
    for (const l of lists) expect(l).toHaveClass('grid');
  });
});

describe('Show all and back', () => {
  it('starts the page at the top: the shell scroller, not <main>, is reset', () => {
    const scroller = document.createElement('div');
    scroller.setAttribute('data-app-scroller', '');
    document.body.appendChild(scroller);
    try {
      scroller.scrollTop = 600;
      expect(scroller.scrollTop).toBe(600);
      state.focus = 'trending';
      render(<HomePage />);
      expect(scroller.scrollTop).toBe(0);
    } finally {
      scroller.remove();
    }
  });
});
