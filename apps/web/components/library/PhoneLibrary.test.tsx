import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { toSummary } from '@/lib/collections';
import { buildLibraryItems, type LibraryInput, type LibraryView } from '@/lib/library';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>{children}</div>
  ),
}));

const { PhoneLibrary } = await import('./PhoneLibrary');

const art = (n: number) => `https://img.test/${n}.jpg`;
const songs = (...arts: number[]) => arts.map((n) => ({ artworkUrl: n ? art(n) : null }));
const pl = (id: string, name: string, extra: Parameters<typeof toSummary>[1] = {}, pinned = false) => ({
  ...toSummary({ kind: 'playlist', id }, { name, ...extra }),
  pinned,
});

const handlers = {
  onViewChange: vi.fn(),
  onOpenPlaylist: vi.fn(),
  onNewPlaylist: vi.fn(),
  onCarlist: vi.fn(),
  onImport: vi.fn(),
};

function setup({ input = {}, view = 'list', carlistLive = false }: { input?: Partial<LibraryInput>; view?: LibraryView; carlistLive?: boolean } = {}) {
  const full: LibraryInput = {
    liked: songs(1, 2),
    history: songs(1, 2, 3, 4, 5),
    uploads: songs(7),
    playlists: [
      pl('p1', 'Zebra', { trackCount: 23 }),
      pl('p2', 'apple', { trackCount: 1, downloaded: true }),
      pl('p3', 'Mango', { trackCount: 4 }),
    ],
    downloadedIds: new Set(['p2']),
    ...input,
  };
  return render(
    <PhoneLibrary
      items={buildLibraryItems(full)}
      hasPlaylists={full.playlists.length > 0}
      profile={{ name: 'Aron', email: 'a@b.c', avatarUrl: null }}
      view={view}
      carlistLive={carlistLive}
      importPlaylistHref="/transfer?to=playlist"
      {...handlers}
    />,
  );
}

const titles = () =>
  [...document.querySelectorAll('[data-library-item]')].map((el) => el.querySelector('.truncate')?.textContent);
const row = (key: string) => document.querySelector(`[data-library-item="${key}"]`) as HTMLElement;
const chip = (name: string) => within(screen.getByRole('toolbar', { name: 'Filter your library' })).getByRole('button', { name });

beforeEach(() => vi.clearAllMocks());

describe('PhoneLibrary', () => {
  it('has the Spotify header: avatar to profile, Your Library, search and +, and no carlist or upload squircles', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Your Library' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile and settings' })).toHaveAttribute('href', '/settings/profile');
    expect(screen.getByRole('button', { name: 'Search your library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create or import' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload songs' })).toBeNull();
    expect(screen.queryByTestId('carlist-entry')).toBeNull();
    expect(document.querySelector('[data-shape="squircle"]')).toBeNull();
  });

  it('lists the system collections first, Downloaded only with downloads, then the playlists', () => {
    const { unmount } = setup();
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'Zebra', 'apple', 'Mango']);
    unmount();
    setup({ input: { downloadedIds: new Set(), playlists: [pl('p1', 'Zebra')] } });
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Zebra']);
  });

  it('rows read "Playlist · 23 songs" with the green download mark and the pin mark where they apply', () => {
    setup({
      input: { playlists: [pl('p3', 'Mango', { trackCount: 4 }, true), pl('p1', 'Zebra', { trackCount: 23 }), pl('p2', 'apple', { downloaded: true })] },
    });
    expect(row('playlist:p1')).toHaveTextContent('Playlist · 23 songs');
    expect(row('recent')).toHaveTextContent('Auto playlist · 5 songs');
    expect(within(row('playlist:p2')).getByRole('img', { name: 'Downloaded' })).toBeInTheDocument();
    expect(within(row('playlist:p1')).queryByRole('img', { name: 'Downloaded' })).toBeNull();
    expect(row('playlist:p3').querySelector('[data-pinned-mark]')).not.toBeNull();
    expect(row('playlist:p1').querySelector('[data-pinned-mark]')).toBeNull();
    // 56px art, one-line title.
    expect(row('playlist:p1').querySelector('.size-14')).not.toBeNull();
  });

  it('chips filter, and tapping the active chip clears it; Mixes only when there are mixes', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Mixes' })).toBeNull();
    fireEvent.click(chip('Playlists'));
    expect(chip('Playlists')).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toEqual(['Zebra', 'apple', 'Mango']);
    fireEvent.click(chip('Downloaded'));
    expect(chip('Playlists')).toHaveAttribute('aria-pressed', 'false');
    expect(titles()).toEqual(['apple']);
    fireEvent.click(chip('Downloaded'));
    expect(chip('Downloaded')).toHaveAttribute('aria-pressed', 'false');
    expect(titles()).toHaveLength(7);
  });

  it('the chips stick to the top while the list scrolls', () => {
    setup();
    expect(screen.getByRole('toolbar', { name: 'Filter your library' })).toHaveClass('sticky', 'top-0');
  });

  it('the Downloaded row turns the Downloaded chip on', () => {
    setup();
    fireEvent.click(row('downloaded'));
    expect(chip('Downloaded')).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toEqual(['apple']);
  });

  it('opening a playlist reports it (it moves up Recents); a system collection does not', () => {
    setup();
    fireEvent.click(row('playlist:p3'));
    expect(handlers.onOpenPlaylist).toHaveBeenCalledWith('p3');
    fireEvent.click(row('liked'));
    expect(handlers.onOpenPlaylist).toHaveBeenCalledTimes(1);
    expect(row('liked')).toHaveAttribute('href', '/library/liked');
  });

  it('the sort toggles between Recents and Alphabetical, system collections staying first', () => {
    setup();
    const sort = screen.getByTestId('library-sort');
    expect(sort).toHaveTextContent('Recents');
    fireEvent.click(sort);
    expect(sort).toHaveTextContent('Alphabetical');
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'apple', 'Mango', 'Zebra']);
    fireEvent.click(sort);
    expect(sort).toHaveTextContent('Recents');
    expect(titles().slice(4)).toEqual(['Zebra', 'apple', 'Mango']);
  });

  it('the view toggle asks for the other view; grid is three across, same items', () => {
    const { unmount } = setup();
    expect(document.querySelector('[data-library-view="list"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show as grid' }));
    expect(handlers.onViewChange).toHaveBeenCalledWith('grid');
    unmount();
    setup({ view: 'grid' });
    expect(document.querySelector('[data-library-view="grid"]')).toHaveClass('grid-cols-3');
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'Zebra', 'apple', 'Mango']);
    fireEvent.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(handlers.onViewChange).toHaveBeenCalledWith('list');
  });

  it('search filters the list by name inline, and closing it brings everything back', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search your library' }));
    const input = screen.getByRole('searchbox', { name: 'Search Your Library' });
    fireEvent.change(input, { target: { value: 'ZEB' } });
    expect(titles()).toEqual(['Zebra']);
    fireEvent.change(input, { target: { value: 'nothing like it' } });
    expect(titles()).toEqual([]);
    expect(screen.getByText(/Nothing in your library matches/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(titles()).toHaveLength(7);
  });

  it('the + menu: New playlist, Start a carlist, Import, each calling its flow', () => {
    setup();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['New playlist', 'Start a carlist', 'Import']);
    fireEvent.click(screen.getByRole('menuitem', { name: /New playlist/ }));
    expect(handlers.onNewPlaylist).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('menuitem', { name: /Start a carlist/ }));
    expect(handlers.onCarlist).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('menuitem', { name: /Import/ }));
    expect(handlers.onImport).toHaveBeenCalledTimes(1);
  });

  it('with a carlist live, the carlist item says it opens yours', () => {
    setup({ carlistLive: true });
    expect(screen.getByRole('menuitem', { name: /Open your carlist/ })).toBeInTheDocument();
  });

  it('with no playlists: the friendly card under the system collections, with Create playlist and the import link', () => {
    setup({ input: { playlists: [], downloadedIds: new Set() } });
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads']);
    const card = screen.getByRole('region', { name: 'Create your first playlist' });
    expect(card.querySelector('[data-empty-art]')).not.toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Create playlist' }));
    expect(handlers.onNewPlaylist).toHaveBeenCalledTimes(1);
    expect(within(card).getByRole('link', { name: 'Import from Spotify or YouTube' })).toHaveAttribute('href', '/transfer?to=playlist');
    // The Playlists chip still shows the card; Downloaded does not.
    fireEvent.click(chip('Playlists'));
    expect(screen.getByRole('region', { name: 'Create your first playlist' })).toBeInTheDocument();
    fireEvent.click(chip('Downloaded'));
    expect(screen.queryByRole('region', { name: 'Create your first playlist' })).toBeNull();
  });

  it('with playlists there is no empty card', () => {
    setup();
    expect(screen.queryByRole('region', { name: 'Create your first playlist' })).toBeNull();
  });

  it('covers: Liked a white heart, Recently played and Uploads their own gradient with a white glyph', () => {
    setup();
    expect(row('liked').querySelector('[data-liked-cover]')).not.toBeNull();
    for (const [key, kind, gradient] of [
      ['recent', 'recent', '#246373'],
      ['uploads', 'uploads', '#a16a2c'],
    ]) {
      const cover = row(key).querySelector(`[data-library-cover="${kind}"]`)!;
      expect(cover.querySelector('img')).toBeNull();
      const tile = cover.querySelector('[data-glyph-tile]') as HTMLElement;
      expect(tile.getAttribute('style')).toContain(gradient);
      expect(tile.querySelector('svg')).not.toBeNull();
    }
  });
});
