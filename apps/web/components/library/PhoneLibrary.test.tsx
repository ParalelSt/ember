import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { toSummary, type CollectionSummary } from '@/lib/collections';
import { LIBRARY_VIEW_KEY } from '@/lib/library';
import type { Track } from '@/types/track';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const state = vi.hoisted(() => ({
  push: vi.fn(),
  liked: [] as Partial<Track>[],
  history: [] as Partial<Track>[],
  uploads: [] as Partial<Track>[],
  playlists: [] as CollectionSummary[],
  pinned: [] as string[],
  downloaded: new Set<string>(),
  carlist: null as { id: string } | null,
  onOpen: vi.fn(),
  handleCreate: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' }, name: 'Aron', avatarUrl: null }),
}));
vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({ system: [], playlists: state.playlists, downloadedIds: state.downloaded, isLoading: false }),
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryLikes: () => ({ data: state.liked }),
  useQueryHistory: () => ({ data: state.history }),
  useQueryUploads: () => ({ data: state.uploads }),
}));
// The real ordering is lib/navPlaylists' own tests: pinned first, kept in order.
vi.mock('@/hooks/useNavPlaylists', () => ({
  useNavPlaylists: <T extends { id: string }>(items: T[]) => ({
    items: [
      ...items.filter((i) => state.pinned.includes(i.id)),
      ...items.filter((i) => !state.pinned.includes(i.id)),
    ].map((i) => ({ ...i, pinned: state.pinned.includes(i.id) })),
    onOpen: state.onOpen,
    onTogglePin: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSession', () => ({ useQueryLiveCarlist: () => ({ data: state.carlist }) }));
vi.mock('@/hooks/useCreatePlaylistFlow', async () => {
  const { useState } = await import('react');
  return {
    useCreatePlaylistFlow: () => {
      const [createOpen, setCreateOpen] = useState(false);
      return { createOpen, setCreateOpen, handleCreate: state.handleCreate };
    },
  };
});
vi.mock('@/components/track/menus/CreatePlaylistDialog', () => ({
  CreatePlaylistDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="New playlist" /> : null),
}));
vi.mock('@/components/session/SessionDialogs', () => ({
  StartSessionDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Start a carlist" /> : null),
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>{children}</div>
  ),
}));

const { PhoneLibrary, LIBRARY_IMPORT_HREF, LIBRARY_IMPORT_PLAYLIST_HREF } = await import('./PhoneLibrary');

const art = (n: number) => `https://img.test/${n}.jpg`;
const songs = (...arts: number[]) => arts.map((n, i) => ({ id: `t${i}`, artworkUrl: n ? art(n) : null }));
const pl = (id: string, name: string, extra: Parameters<typeof toSummary>[1] = {}) =>
  toSummary({ kind: 'playlist', id }, { name, ...extra });

const titles = () =>
  [...document.querySelectorAll('[data-library-item]')].map((el) => el.querySelector('.truncate')?.textContent);
const chip = (name: string) => within(screen.getByRole('toolbar', { name: 'Filter your library' })).getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.liked = songs(1, 2);
  state.history = songs(1, 2, 3, 4, 5);
  state.uploads = songs(7);
  state.playlists = [
    pl('p1', 'Zebra', { trackCount: 23 }),
    pl('p2', 'apple', { trackCount: 1, downloaded: true }),
    pl('p3', 'Mango', { trackCount: 4 }),
  ];
  state.pinned = [];
  state.downloaded = new Set(['p2']);
  state.carlist = null;
});

describe('PhoneLibrary', () => {
  it('has the Spotify header: avatar to profile, Your Library, search and +, and no carlist or upload squircles', () => {
    render(<PhoneLibrary />);
    expect(screen.getByRole('heading', { level: 1, name: 'Your Library' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile and settings' })).toHaveAttribute('href', '/settings/profile');
    expect(screen.getByRole('button', { name: 'Search your library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create or import' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload songs' })).toBeNull();
    expect(screen.queryByTestId('carlist-entry')).toBeNull();
    expect(document.querySelector('[data-shape="squircle"]')).toBeNull();
  });

  it('lists the system collections first, Downloaded only with downloads, then playlists in Recents order', () => {
    const { unmount } = render(<PhoneLibrary />);
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'Zebra', 'apple', 'Mango']);
    unmount();
    state.downloaded = new Set();
    state.playlists = state.playlists.map((p) => ({ ...p, downloaded: false }));
    render(<PhoneLibrary />);
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Zebra', 'apple', 'Mango']);
  });

  it('rows read "Playlist · 23 songs" with the green download mark and the pin mark where they apply', () => {
    state.pinned = ['p3'];
    render(<PhoneLibrary />);
    const row = (key: string) => document.querySelector(`[data-library-item="${key}"]`) as HTMLElement;
    expect(row('playlist:p1')).toHaveTextContent('Playlist · 23 songs');
    expect(row('recent')).toHaveTextContent('Auto playlist · 5 songs');
    expect(within(row('playlist:p2')).getByRole('img', { name: 'Downloaded' })).toBeInTheDocument();
    expect(within(row('playlist:p1')).queryByRole('img', { name: 'Downloaded' })).toBeNull();
    expect(row('playlist:p3').querySelector('[data-pinned-mark]')).not.toBeNull();
    expect(row('playlist:p1').querySelector('[data-pinned-mark]')).toBeNull();
    // Pinned comes first among the playlists.
    expect(titles().slice(4)).toEqual(['Mango', 'Zebra', 'apple']);
  });

  it('chips filter, and tapping the active chip clears it', () => {
    render(<PhoneLibrary />);
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

  it('the Downloaded row turns the Downloaded chip on', () => {
    render(<PhoneLibrary />);
    fireEvent.click(document.querySelector('[data-library-item="downloaded"]')!);
    expect(chip('Downloaded')).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toEqual(['apple']);
  });

  it('opening a playlist moves it up Recents', () => {
    render(<PhoneLibrary />);
    fireEvent.click(document.querySelector('[data-library-item="playlist:p3"]')!);
    expect(state.onOpen).toHaveBeenCalledWith('p3');
  });

  it('the sort toggles between Recents and Alphabetical, system collections staying first', () => {
    render(<PhoneLibrary />);
    const sort = screen.getByTestId('library-sort');
    expect(sort).toHaveTextContent('Recents');
    fireEvent.click(sort);
    expect(sort).toHaveTextContent('Alphabetical');
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'apple', 'Mango', 'Zebra']);
    fireEvent.click(sort);
    expect(sort).toHaveTextContent('Recents');
    expect(titles().slice(4)).toEqual(['Zebra', 'apple', 'Mango']);
  });

  it('the view toggle switches to a two-column grid of the same items and is remembered on this device', () => {
    const { unmount } = render(<PhoneLibrary />);
    expect(document.querySelector('[data-library-view="list"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show as grid' }));
    const grid = document.querySelector('[data-library-view="grid"]')!;
    expect(grid).toHaveClass('grid-cols-2');
    expect(titles()).toHaveLength(7);
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe('grid');
    unmount();
    render(<PhoneLibrary />);
    expect(document.querySelector('[data-library-view="grid"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe('list');
  });

  it('search filters the list by name inline, and closing it brings everything back', () => {
    render(<PhoneLibrary />);
    fireEvent.click(screen.getByRole('button', { name: 'Search your library' }));
    const input = screen.getByRole('searchbox', { name: 'Search Your Library' });
    fireEvent.change(input, { target: { value: 'ZEB' } });
    expect(titles()).toEqual(['Zebra']);
    fireEvent.change(input, { target: { value: 'nothing like it' } });
    expect(titles()).toEqual([]);
    expect(screen.getByText(/Nothing in your library matches/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(titles()).toHaveLength(7);
  });

  it('the + menu: New playlist opens the create dialog, Start a carlist the start dialog, Import the Transfer flow', () => {
    render(<PhoneLibrary />);
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent?.trim());
    expect(items).toEqual(['New playlist', 'Start a carlist', 'Import']);
    fireEvent.click(screen.getByRole('menuitem', { name: /New playlist/ }));
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Start a carlist/ }));
    expect(screen.getByRole('dialog', { name: 'Start a carlist' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Import/ }));
    expect(state.push).toHaveBeenCalledWith(LIBRARY_IMPORT_HREF);
    expect(LIBRARY_IMPORT_HREF).toBe('/transfer?from=%2Flibrary');
  });

  it('with a carlist live, the carlist item opens it instead', () => {
    state.carlist = { id: 's9' };
    render(<PhoneLibrary />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Open your carlist/ }));
    expect(state.push).toHaveBeenCalledWith('/session/s9');
    expect(screen.queryByRole('dialog', { name: 'Start a carlist' })).toBeNull();
  });

  it('with no playlists: the friendly card with Create playlist and the import link, under the system collections', () => {
    state.playlists = [];
    state.downloaded = new Set();
    render(<PhoneLibrary />);
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads']);
    const card = screen.getByRole('region', { name: 'Create your first playlist' });
    fireEvent.click(within(card).getByRole('button', { name: 'Create playlist' }));
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Import from Spotify or YouTube' })).toHaveAttribute('href', LIBRARY_IMPORT_PLAYLIST_HREF);
    // The Playlists chip still shows the card; Downloaded does not.
    fireEvent.click(chip('Playlists'));
    expect(screen.getByRole('region', { name: 'Create your first playlist' })).toBeInTheDocument();
    fireEvent.click(chip('Downloaded'));
    expect(screen.queryByRole('region', { name: 'Create your first playlist' })).toBeNull();
  });

  it('with playlists there is no empty card', () => {
    render(<PhoneLibrary />);
    expect(screen.queryByRole('region', { name: 'Create your first playlist' })).toBeNull();
  });

  it('covers: Liked keeps the sound-wave heart, Recently played a mosaic with its badge, Uploads one cover with its badge', async () => {
    await act(async () => {
      render(<PhoneLibrary />);
    });
    const cover = (key: string) => document.querySelector(`[data-library-item="${key}"] [data-library-cover], [data-library-item="${key}"] .aspect-square`) as HTMLElement;
    expect(cover('liked').querySelector('[data-liked-cover]')).not.toBeNull();
    expect(cover('recent')).toHaveAttribute('data-look', 'mosaic');
    expect(cover('recent').querySelectorAll('[data-mosaic] img')).toHaveLength(4);
    expect(cover('recent').querySelector('[data-badge]')).not.toBeNull();
    expect(cover('uploads')).toHaveAttribute('data-look', 'single');
    expect(cover('uploads').querySelector('[data-badge]')).not.toBeNull();
  });
});
