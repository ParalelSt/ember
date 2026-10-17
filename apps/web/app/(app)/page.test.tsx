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
  trendingLoading: false,
  recommended: [] as Track[],
  playlists: [] as ReturnType<typeof toSummary>[],
  carlist: null as LiveCarlist | null,
  context: null as PlaybackContext | null,
  current: null as Track | null,
  isPlaying: false,
  playTrack: vi.fn(),
  toggle: vi.fn(),
  playCollection: vi.fn(),
  collectionPlaying: null as string | null,
  mixes: undefined as undefined | { eligible: boolean; building: boolean; mixes: { key: string; title: string; subtitle: string; cover: { artworkUrls: string[]; color: string }; builtAt: string; count: number }[] },
  charts: undefined as undefined | { popular: unknown; genres: { slug: string; title: string; color: string; artworkUrls: string[]; count: number; fetchedAt: string | null; stale: boolean }[] },
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
  useQueryTrending: () => ({ data: state.trending, isLoading: state.trendingLoading }),
  useQueryRecommended: () => ({ data: state.recommended, isLoading: false }),
  useQueryCharts: () => ({ data: state.charts }),
  useQueryMixes: () => ({ data: state.mixes }),
}));
vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({
    system: [toSummary({ kind: 'liked' }, { count: state.liked.length })],
    playlists: state.playlists,
  }),
}));
vi.mock('@/hooks/useSession', () => ({ useQueryLiveCarlist: () => ({ data: state.carlist }) }));
// Its own tests cover fetching the songs; here it only has to be asked.
vi.mock('@/hooks/usePlayCollection', () => ({
  usePlayCollection: () => ({
    play: state.playCollection,
    isPlaying: (ref: { kind: string; id?: string }) => (ref.kind === 'playlist' ? ref.id : ref.kind) === state.collectionPlaying,
  }),
}));
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
    trendingLoading: false,
    recommended: makeTracks('rec', 6),
    playlists: [
      toSummary({ kind: 'playlist', id: 'p1' }, { name: 'Road trip' }),
      toSummary({ kind: 'playlist', id: 'p2' }, { name: 'Gym' }),
    ],
    carlist: null,
    context: null,
    current: null,
    isPlaying: false,
    collectionPlaying: null,
    charts: undefined,
    mixes: undefined,
  });
});

const mixTile = (key: string, title: string, count = 50) => ({
  key, title, subtitle: `${title} Band, Other Band and more`, cover: { artworkUrls: [`/art/${key}a.jpg`, `/art/${key}b.jpg`, `/art/${key}c.jpg`], color: '#f2b8a8' },
  builtAt: '2026-10-16T04:00:00.000Z', count,
});
const someMixes = () => ({ eligible: true, building: false, mixes: [mixTile('rock-metal', 'Rock & Metal'), mixTile('balkan', 'Balkan'), mixTile('pop', 'Pop')] });

const genre = (slug: string, title: string) => ({
  slug, title, color: '#123456', artworkUrls: [`/art/${slug}1.jpg`, `/art/${slug}2.jpg`], count: 50, fetchedAt: '2026-10-16T08:00:00Z', stale: false,
});
const someCharts = () => ({ popular: {}, genres: [genre('balkan', 'Balkan'), genre('rock', 'Rock'), genre('pop', 'Pop')] });

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
    state.playlists = Array.from({ length: ROW_MAX + 1 }, (_, i) => toSummary({ kind: 'playlist', id: `p${i}` }, { name: `List ${i}` }));
    render(<HomePage />);
    const showAll = (name: string) =>
      within(screen.getByRole('region', { name })).getByRole('link', { name: 'Show all' });
    expect(showAll('Recently played')).toHaveAttribute('href', '/?focus=history');
    // Popular now is a row of chart tiles: no Show all.
    expect(within(screen.getByRole('region', { name: 'Popular now' })).queryByRole('link', { name: 'Show all' })).toBeNull();
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

  it('shows All (active, ember), Playlists and Charts, and no Mixes yet', () => {
    render(<HomePage />);
    const bar = screen.getByRole('toolbar', { name: 'Filter Home' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Playlists', 'Charts']);
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

  it('has no chips to pick from without playlists or charts', () => {
    state.playlists = [];
    state.trending = [];
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
    fireEvent.click(screen.getByText('hist song 2'));
    expect(state.playTrack).toHaveBeenCalledWith(state.history[2], state.history);
    expect(state.toggle).not.toHaveBeenCalled();
  });

  it('marks the playing track and toggles it on a re-tap', () => {
    state.current = state.history[1];
    state.isPlaying = true;
    render(<HomePage />);
    const title = screen.getByText('hist song 1');
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

describe('Home on a desktop window (the owner\'s picks)', () => {
  beforeEach(() => {
    state.desktop = true;
  });
  const chip = (name: string) => within(screen.getByRole('toolbar', { name: 'Filter Home' })).getByRole('button', { name });
  const grid = () => screen.getByRole('list', { name: 'Your collections' });

  it('has no big Home title; chips, then the 4-column quick grid', () => {
    render(<HomePage />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    const bar = screen.getByRole('toolbar', { name: 'Filter Home' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Playlists', 'Charts']);
    expect(chip('All')).toHaveClass('bg-ember');
    expect(bar).not.toHaveClass('sticky');
    expect(grid()).toHaveClass('grid-cols-4');
    // The chips come first, then the grid.
    expect(bar.compareDocumentPosition(grid()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('holds eight tiles: Liked songs, then your playlists', () => {
    state.playlists = Array.from({ length: 9 }, (_, i) => toSummary({ kind: 'playlist', id: `p${i}` }, { name: `List ${i}` }));
    render(<HomePage />);
    const names = within(grid()).getAllByRole('link').map((a) => a.textContent);
    expect(names).toHaveLength(8);
    expect(names.slice(0, 2)).toEqual(['Liked songs', 'List 0']);
  });

  it('orders the rows like the phone (order B), with Popular now and no "From your liked songs"', () => {
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
    expect(screen.getByRole('region', { name: 'Friends are listening to' })).toHaveAttribute('data-layout', 'desktop-row');
  });

  it('the Playlists chip keeps the grid and Your playlists only', () => {
    render(<HomePage />);
    fireEvent.click(chip('Playlists'));
    expect(grid()).toBeInTheDocument();
    expect(headings()).toEqual(['Your playlists']);
  });

  it('every row scrolls sideways with 180px tiles and < > in its header, Show all only when there is more', () => {
    state.history = makeTracks('hist', ROW_MAX + 1);
    render(<HomePage />);
    for (const name of ['Recently played', 'Because you played "hist song 0"', 'Popular now', 'Your playlists']) {
      const region = within(screen.getByRole('region', { name }));
      const row = region.getByRole('list');
      expect(row).toHaveClass('flex', 'overflow-x-auto');
      expect(region.getAllByRole('listitem')[0]).toHaveClass('w-[180px]');
      expect(region.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument();
      expect(region.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument();
      expect(region.getByRole('heading', { level: 2 })).toHaveClass('text-2xl', 'font-bold');
    }
    expect(within(screen.getByRole('region', { name: 'Recently played' })).getByRole('link', { name: 'Show all' }))
      .toHaveAttribute('href', '/?focus=history');
    expect(within(screen.getByRole('region', { name: 'Popular now' })).queryByRole('link', { name: 'Show all' })).toBeNull();
  });

  it('uses the full width: no bleed past the gutter and the content cap lifted', () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector('[data-home-wide]')).not.toBeNull();
    for (const row of document.querySelectorAll('[data-row-shelf]')) expect(row.className).not.toMatch(/-mx-|px-page/);
    expect(document.querySelector('[data-hero]')).toBeNull();
  });

  it('a song tile plays its row, the current one toggles and stays marked', () => {
    state.current = state.history[1];
    state.isPlaying = true;
    render(<HomePage />);
    const row = within(screen.getByRole('region', { name: 'Recently played' }));
    fireEvent.click(row.getByText('hist song 3'));
    expect(state.playTrack).toHaveBeenCalledWith(state.history[3], state.history);
    expect(row.getByText('hist song 1')).toHaveClass('text-ember', 'text-[15px]');
    fireEvent.click(row.getByRole('button', { name: 'Pause' }));
    expect(state.toggle).toHaveBeenCalledTimes(1);
  });

  it('the hover play buttons on the quick grid and on Your playlists play that collection', () => {
    render(<HomePage />);
    fireEvent.click(within(grid()).getByRole('button', { name: 'Play Liked songs' }));
    expect(state.playCollection).toHaveBeenLastCalledWith({ kind: 'liked' }, 'Liked songs');
    fireEvent.click(within(grid()).getByRole('button', { name: 'Play Gym' }));
    expect(state.playCollection).toHaveBeenLastCalledWith({ kind: 'playlist', id: 'p2' }, 'Gym');
    const lists = within(screen.getByRole('region', { name: 'Your playlists' }));
    fireEvent.click(lists.getByRole('button', { name: 'Play Road trip' }));
    expect(state.playCollection).toHaveBeenLastCalledWith({ kind: 'playlist', id: 'p1' }, 'Road trip');
  });

  it('shows Pause on the collection that is playing', () => {
    state.collectionPlaying = 'p1';
    render(<HomePage />);
    expect(within(grid()).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Your playlists' })).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('Because you played is a normal row of 180px tiles with the same gap, no hero card', () => {
    render(<HomePage />);
    const region = within(screen.getByRole('region', { name: 'Because you played "hist song 0"' }));
    expect(document.querySelector('[data-hero]')).toBeNull();
    const items = region.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    for (const item of items) expect(item).toHaveClass('w-[180px]', 'shrink-0');
    expect(region.getByRole('list')).toHaveClass('gap-block');
    expect(region.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument();
    fireEvent.click(region.getByText('rec song 3'));
    expect(state.playTrack).toHaveBeenLastCalledWith(state.recommended[3], state.recommended);
  });

  it('every desktop row shares one tile width and one gap', () => {
    render(<HomePage />);
    const rows = document.querySelectorAll('[data-row-shelf="wide"]');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row).toHaveClass('gap-block');
      for (const item of row.children) expect(item).toHaveClass('w-[180px]');
    }
  });

  it('Show all still opens the full grid of that row', () => {
    state.focus = 'trending';
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Popular now' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your collections' })).toBeNull();
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

describe('Popular now chart tiles on Home', () => {
  const chip = (name: string) => within(screen.getByRole('toolbar', { name: 'Filter Home' })).getByRole('button', { name });
  const hrefs = () => within(screen.getByRole('region', { name: 'Popular now' })).getAllByRole('link').map((a) => a.getAttribute('href'));

  it('is one row of chart tiles: Top songs first (opening the full list), genre tiles after in order', () => {
    state.charts = someCharts();
    render(<HomePage />);
    expect(headings()).toEqual([
      'Recently played',
      'Because you played "hist song 0"',
      'Popular now',
      'Your playlists',
      'Friends are listening to',
    ]);
    expect(hrefs()).toEqual(['/chart/popular', '/chart/balkan', '/chart/rock', '/chart/pop']);
    const row = within(screen.getByRole('region', { name: 'Popular now' }));
    const top = row.getByRole('link', { name: 'Top songs chart' });
    expect(top.textContent).toContain('Top 5');
    expect(top.querySelector('div')).toHaveStyle({ backgroundColor: '#b4372a' });
    expect(row.getByRole('link', { name: 'Rock chart' }).textContent).toContain('Top 50');
    // A sideways row on the gutter like the others, and no song cards.
    expect(row.getByRole('list')).toHaveClass('flex', 'overflow-x-auto', '-mx-page', 'px-page');
    expect(screen.queryByText('trend song 0')).toBeNull();
  });

  it('has no separate Charts by genre row', () => {
    state.charts = someCharts();
    render(<HomePage />);
    expect(screen.queryByRole('region', { name: 'Charts by genre' })).toBeNull();
    expect(screen.getAllByRole('region', { name: 'Popular now' })).toHaveLength(1);
  });

  it('keeps every genre chart, even past the usual row cap', () => {
    state.charts = { popular: {}, genres: Array.from({ length: ROW_MAX + 3 }, (_, i) => genre(`g${i}`, `G${i}`)) };
    render(<HomePage />);
    expect(hrefs()).toHaveLength(ROW_MAX + 4);
  });

  it('the Charts chip keeps the tile row only', () => {
    state.charts = someCharts();
    render(<HomePage />);
    fireEvent.click(chip('Charts'));
    expect(headings()).toEqual(['Popular now']);
    expect(hrefs()).toHaveLength(4);
    expect(screen.queryByRole('list', { name: 'Your collections' })).toBeNull();
  });

  it('still shows Top songs while genre charts are unavailable', () => {
    state.charts = { popular: {}, genres: [] };
    render(<HomePage />);
    expect(hrefs()).toEqual(['/chart/popular']);
    expect(chip('Charts')).toBeInTheDocument();
  });

  it('shows genre tiles alone when trending is empty', () => {
    state.trending = [];
    state.charts = someCharts();
    render(<HomePage />);
    expect(hrefs()).toEqual(['/chart/balkan', '/chart/rock', '/chart/pop']);
  });

  it('shows a loading placeholder for Top songs while trending loads', () => {
    state.trending = [];
    state.trendingLoading = true;
    state.charts = someCharts();
    render(<HomePage />);
    const region = screen.getByRole('region', { name: 'Popular now' });
    expect(region.querySelector('[data-chart-loading]')).not.toBeNull();
    expect(hrefs()).toEqual(['/chart/balkan', '/chart/rock', '/chart/pop']);
  });

  it('hides the row and the Charts chip when both are empty', () => {
    state.trending = [];
    state.charts = { popular: {}, genres: [] };
    render(<HomePage />);
    expect(screen.queryByRole('region', { name: 'Popular now' })).toBeNull();
    expect(within(screen.getByRole('toolbar', { name: 'Filter Home' })).queryByRole('button', { name: 'Charts' })).toBeNull();
  });

  it('uses the wide row of 180px tiles on a desktop', () => {
    state.desktop = true;
    state.charts = someCharts();
    render(<HomePage />);
    const region = screen.getByRole('region', { name: 'Popular now' });
    expect(region.querySelector('[data-row-shelf="wide"]')).not.toBeNull();
    expect(within(region).getAllByRole('listitem')[0]).toHaveClass('w-[180px]');
    expect(hrefs()[0]).toBe('/chart/popular');
  });

  it('keeps the focus view of the full trending list for old links', () => {
    state.focus = 'trending';
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Popular now' })).toBeInTheDocument();
  });
});

describe('Your mixes on Home', () => {
  const chip = (name: string) => within(screen.getByRole('toolbar', { name: 'Filter Home' })).getByRole('button', { name });

  it('puts Your mixes first under the quick grid (order B), Radio cards linking to each mix', () => {
    state.mixes = someMixes();
    state.charts = someCharts();
    render(<HomePage />);
    expect(headings()).toEqual([
      'Your mixes',
      'Recently played',
      'Because you played "hist song 0"',
      'Popular now',
      'Your playlists',
      'Friends are listening to',
    ]);
    const row = within(screen.getByRole('region', { name: 'Your mixes' }));
    expect(row.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/mix/rock-metal', '/mix/balkan', '/mix/pop']);
    const card = row.getByRole('link', { name: 'Rock & Metal Mix' });
    expect(card.textContent).toContain('MIX');
    expect(card.querySelectorAll('[data-mix-face]')).toHaveLength(3);
    expect(row.getByText('Rock & Metal Band, Other Band and more')).toBeInTheDocument();
    // 172px cards on the gutter.
    expect(row.getAllByRole('listitem')[0]).toHaveClass('w-[172px]');
    expect(row.getByRole('list')).toHaveClass('-mx-page', 'px-page', 'scroll-px-page');
  });

  it('gives the top two mixes a quick grid slot after Liked songs', () => {
    state.mixes = someMixes();
    render(<HomePage />);
    const grid = screen.getByRole('list', { name: 'Your collections' });
    expect(within(grid).getAllByRole('link').map((a) => a.textContent)).toEqual(['Liked songs', 'Rock & Metal Mix', 'Balkan Mix', 'Road trip', 'Gym']);
    expect(within(grid).getByRole('link', { name: 'Balkan Mix' })).toHaveAttribute('href', '/mix/balkan');
  });

  it('brings the Mixes chip, which keeps the mixes row only', () => {
    state.mixes = someMixes();
    render(<HomePage />);
    fireEvent.click(chip('Mixes'));
    expect(headings()).toEqual(['Your mixes']);
    expect(screen.queryByRole('list', { name: 'Your collections' })).toBeNull();
  });

  it('has no row, chip or grid slot without mixes (not eligible, or still building)', () => {
    state.mixes = { eligible: false, building: false, mixes: [] };
    render(<HomePage />);
    expect(screen.queryByRole('region', { name: 'Your mixes' })).toBeNull();
    expect(within(screen.getByRole('toolbar', { name: 'Filter Home' })).queryByRole('button', { name: 'Mixes' })).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Your collections' })).queryByText(/ Mix$/)).toBeNull();
  });

  it('leaves out a mix whose songs are all gone', () => {
    state.mixes = { eligible: true, building: false, mixes: [mixTile('rock-metal', 'Rock & Metal', 0), mixTile('pop', 'Pop')] };
    render(<HomePage />);
    const row = within(screen.getByRole('region', { name: 'Your mixes' }));
    expect(row.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/mix/pop']);
  });

  it('uses the wide row on a desktop', () => {
    state.desktop = true;
    state.mixes = someMixes();
    render(<HomePage />);
    expect(screen.getByRole('region', { name: 'Your mixes' }).querySelector('[data-row-shelf="wide"]')).not.toBeNull();
  });
});
