import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import HomePage from './page';
import { toSummary } from '@/lib/collections';
import { ROW_MAX } from '@/components/page/RowShelf';
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
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Aron' } }) }));
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

  it('orders the rows like the owner\'s order B, with Popular now and no "From your liked songs"', () => {
    render(<HomePage />);
    expect(headings()).toEqual([
      'Recently played',
      'Because you played "hist song 0"',
      'Popular now',
      'Your playlists',
      'Friends are listening to',
    ]);
    expect(screen.queryByText('Trending right now')).toBeNull();
    expect(screen.queryByText('From your liked songs')).toBeNull();
    expect(screen.getByRole('region', { name: 'Friends are listening to' })).toHaveAttribute('data-layout', 'row');
  });

  it('hides empty rows', () => {
    Object.assign(state, { history: [], liked: [], trending: [], playlists: [] });
    render(<HomePage />);
    expect(headings()).toEqual(['Recommended for you', 'Friends are listening to']);
    // Liked songs stays in the quick grid even with no likes yet.
    expect(within(screen.getByRole('list', { name: 'Your collections' })).getAllByRole('link')).toHaveLength(1);
  });

  it('every row of tiles scrolls sideways', () => {
    render(<HomePage />);
    for (const name of ['Recently played', 'Your playlists', 'Popular now']) {
      const row = within(screen.getByRole('region', { name })).getByRole('list');
      expect(row).toHaveClass('flex', 'overflow-x-auto', 'snap-x');
      expect(row).not.toHaveClass('grid');
    }
  });

  it('lines every row, the chips and the hero card up with the page gutter', () => {
    render(<HomePage />);
    // Sideways rows bleed to the screen edges but pad back to the gutter
    // and snap there.
    for (const row of document.querySelectorAll('[data-row-shelf]')) {
      expect(row).toHaveClass('-mx-page', 'px-page', 'scroll-px-page');
    }
    expect(document.querySelector('[data-home-chips]')).toHaveClass('-mx-page', 'px-page');
    // The big card sits inside the gutter: no negative margin at all.
    const hero = document.querySelector('[data-hero]') as HTMLElement;
    expect(hero.className).not.toMatch(/-m[xl]-/);
    expect(hero.parentElement!.className).not.toMatch(/-m[xl]-/);
  });

  it('offers Show all only on rows that hold more than they show', () => {
    render(<HomePage />);
    // 4 played, 5 popular, 2 playlists: everything is already on screen.
    for (const name of ['Recently played', 'Popular now', 'Your playlists']) {
      expect(within(screen.getByRole('region', { name })).queryByRole('link', { name: 'Show all' })).toBeNull();
    }
    // 6 suggestions, the card holds 4.
    expect(
      within(screen.getByRole('region', { name: 'Because you played "hist song 0"' })).getByRole('link', { name: 'Show all' }),
    ).toHaveAttribute('href', '/?focus=recommended');
  });

  it('links Show all to the focus view, and Your playlists to the Library, once a row overflows', () => {
    state.history = makeTracks('hist', ROW_MAX + 1);
    state.trending = makeTracks('trend', ROW_MAX + 1);
    state.playlists = Array.from({ length: ROW_MAX + 1 }, (_, i) => toSummary({ kind: 'playlist', id: `p${i}` }, { name: `List ${i}` }));
    render(<HomePage />);
    const showAll = (name: string) =>
      within(screen.getByRole('region', { name })).getByRole('link', { name: 'Show all' });
    expect(showAll('Recently played')).toHaveAttribute('href', '/?focus=history');
    expect(showAll('Popular now')).toHaveAttribute('href', '/?focus=trending');
    expect(showAll('Your playlists')).toHaveAttribute('href', '/library');
  });

  it('subtitles tiles like Spotify Recents: "Playlist · <owner>" and "Song · <artist>"', () => {
    state.playlists = [
      toSummary({ kind: 'playlist', id: 'p1' }, { name: 'Road trip' }),
      toSummary({ kind: 'playlist', id: 'p3' }, { name: 'Their list', sharing: { role: 'member', ownerName: 'Olga' } }),
    ];
    render(<HomePage />);
    const lists = within(screen.getByRole('region', { name: 'Your playlists' }));
    expect(lists.getByText('Playlist · Aron')).toBeInTheDocument();
    expect(lists.getByText('Playlist · Olga')).toBeInTheDocument();
    const played = within(screen.getByRole('region', { name: 'Recently played' }));
    expect(played.getAllByText('Song · The Nulls')).toHaveLength(4);
  });

  it('draws a playlist with four song covers as a mosaic, in the grid and in its row', () => {
    const arts = ['a', 'b', 'c', 'd'].map((x) => `/art/${x}.jpg`);
    state.playlists = [toSummary({ kind: 'playlist', id: 'p1' }, { name: 'Road trip', trackArtworks: arts })];
    render(<HomePage />);
    const gridTile = within(screen.getByRole('list', { name: 'Your collections' })).getByRole('link', { name: 'Road trip' });
    expect(gridTile.querySelector('[data-mosaic]')).not.toBeNull();
    const rowTile = within(screen.getByRole('region', { name: 'Your playlists' })).getByRole('link', { name: /Road trip/ });
    expect([...rowTile.querySelectorAll('[data-mosaic] img')].map((i) => i.getAttribute('src'))).toEqual(arts);
  });

  it('holds six tiles in the quick grid', () => {
    state.playlists = Array.from({ length: 9 }, (_, i) => toSummary({ kind: 'playlist', id: `p${i}` }, { name: `List ${i}` }));
    render(<HomePage />);
    expect(within(screen.getByRole('list', { name: 'Your collections' })).getAllByRole('link')).toHaveLength(6);
  });
});

describe('Home filter chips on a phone', () => {
  const chip = (name: string) => within(screen.getByRole('toolbar', { name: 'Filter Home' })).getByRole('button', { name });

  it('shows All (active, ember) and Playlists, and no Mixes or Charts yet', () => {
    render(<HomePage />);
    const bar = screen.getByRole('toolbar', { name: 'Filter Home' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Playlists']);
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('All')).toHaveClass('bg-ember');
    expect(chip('Playlists')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Playlists keeps the quick grid and Your playlists only; All brings everything back', () => {
    render(<HomePage />);
    fireEvent.click(chip('Playlists'));
    expect(chip('Playlists')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('list', { name: 'Your collections' })).toBeInTheDocument();
    expect(headings()).toEqual(['Your playlists']);
    fireEvent.click(chip('All'));
    expect(headings()).toEqual([
      'Recently played',
      'Because you played "hist song 0"',
      'Popular now',
      'Your playlists',
      'Friends are listening to',
    ]);
  });

  it('has no chips to pick from without playlists', () => {
    state.playlists = [];
    render(<HomePage />);
    expect(screen.queryByRole('toolbar', { name: 'Filter Home' })).toBeNull();
  });
});

describe('Because you played: the hero card', () => {
  const card = () => within(screen.getByRole('region', { name: 'Because you played "hist song 0"' }));

  it('shows the first suggestion big, "artist · More like <seed artist>", and the next three as rows', () => {
    render(<HomePage />);
    expect(card().getByText('rec song 0')).toBeInTheDocument();
    expect(card().getByText('The Nulls · More like The Nulls')).toBeInTheDocument();
    expect(card().getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'rec song 1The Nulls',
      'rec song 2The Nulls',
      'rec song 3The Nulls',
    ]);
    expect(card().queryByText('rec song 4')).toBeNull();
  });

  it('the play button plays the list from the top', () => {
    render(<HomePage />);
    fireEvent.click(card().getByRole('button', { name: 'Play these songs' }));
    expect(state.playTrack).toHaveBeenCalledWith(state.recommended[0], state.recommended);
  });

  it('a song row plays from that song', () => {
    render(<HomePage />);
    fireEvent.click(card().getByText('rec song 2'));
    expect(state.playTrack).toHaveBeenCalledWith(state.recommended[2], state.recommended);
  });

  it('toggles when the card\'s song is already the current one', () => {
    state.current = state.recommended[0];
    state.isPlaying = true;
    render(<HomePage />);
    fireEvent.click(card().getByRole('button', { name: 'Pause' }));
    expect(state.toggle).toHaveBeenCalledTimes(1);
    expect(state.playTrack).not.toHaveBeenCalled();
  });
});

describe('Home on a phone, playback', () => {
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

  it('calls the trending grid Popular now on a phone', () => {
    state.focus = 'trending';
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Popular now' })).toBeInTheDocument();
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
