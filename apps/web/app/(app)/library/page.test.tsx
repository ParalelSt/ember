import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { toSummary, type CollectionSummary } from '@/lib/collections';
import { LIBRARY_IMPORT_HREF, LIBRARY_VIEW_KEY } from '@/lib/library';
import { resetLibraryViewMemory } from '@/hooks/useLibraryView';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const state = vi.hoisted(() => ({
  desktop: true,
  online: true,
  push: vi.fn(),
  playlists: [] as CollectionSummary[],
  pinned: [] as string[],
  downloaded: new Set<string>(),
  carlist: null as { id: string } | null,
  onOpen: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => state.online }));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' }, name: 'Aron', avatarUrl: null }),
}));
vi.mock('@/stores/useOfflineStore', () => ({
  useOfflineStore: (sel: (s: { pins: unknown[] }) => unknown) => sel({ pins: [] }),
}));
vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({
    system: [toSummary({ kind: 'liked' }, { count: 3 }), toSummary({ kind: 'recent' }, { count: 1 }), toSummary({ kind: 'uploads' })],
    playlists: state.playlists,
    downloadedIds: state.downloaded,
  }),
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryLikes: () => ({ data: [{ artworkUrl: null }, { artworkUrl: null }, { artworkUrl: null }] }),
  useQueryHistory: () => ({ data: [{ artworkUrl: 'https://img.test/h.jpg' }] }),
  useQueryUploads: () => ({ data: [] }),
}));
// lib/navPlaylists has the real ordering's tests: pinned first.
vi.mock('@/hooks/useNavPlaylists', () => ({
  useNavPlaylists: <T extends { id: string }>(items: T[]) => ({
    items: [...items.filter((i) => state.pinned.includes(i.id)), ...items.filter((i) => !state.pinned.includes(i.id))].map((i) => ({
      ...i,
      pinned: state.pinned.includes(i.id),
    })),
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
      return { createOpen, setCreateOpen, handleCreate: vi.fn() };
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
// The phone's + menu is a sheet from the bottom (popups1).
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, 'data-testid': testId }: PropsWithChildren<{ 'data-testid'?: string }>) => (
    <div data-testid={testId}>{children}</div>
  ),
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));
// The desktop header's own buttons are covered by their tests; here they
// only have to be there.
vi.mock('@/components/session/CarlistButton', () => ({
  CarlistButton: () => <button data-testid="carlist-entry" aria-label="Carlist" />,
}));
vi.mock('@/components/track/menus/UploadTrackDialog', () => ({ UploadTrackDialog: () => null }));

const { default: LibraryPage } = await import('./page');

/** Taps the phone Library's + and then a row of its sheet. */
const fromPlus = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name: 'Create or import' }));
  fireEvent.click(within(screen.getByTestId('action-sheet')).getByRole('button', { name }));
};

const titles = () =>
  [...document.querySelectorAll('[data-library-item]')].map((el) => el.querySelector('.truncate')?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetLibraryViewMemory();
  state.desktop = true;
  state.online = true;
  state.playlists = [
    toSummary({ kind: 'playlist', id: 'p1' }, { name: 'Road Trip', trackCount: 9 }),
    toSummary({ kind: 'playlist', id: 'p2' }, { name: 'Gym', trackCount: 2, downloaded: true }),
  ];
  state.pinned = [];
  state.downloaded = new Set(['p2']);
  state.carlist = null;
});

describe('Library page, md and up', () => {
  it('has a New playlist button beside Upload that opens the create dialog', () => {
    render(<LibraryPage />);
    expect(screen.queryByRole('dialog', { name: 'New playlist' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New playlist' }));
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument();
  });

  it('keeps the desktop shelves exactly: title, carlist and upload buttons, Your collections, Playlists', () => {
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { name: 'Your library' })).toBeInTheDocument();
    expect(screen.getByTestId('carlist-entry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload songs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your collections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    const card = screen.getByRole('link', { name: /Road Trip/ });
    expect(card).toHaveAttribute('href', '/playlist/p1');
    // The unboxed standard tile keeps its old words, not the phone row's.
    expect(card).not.toHaveClass('bg-card', 'p-4');
    // Both sections are the standard grid: 6 across on desktop (3 on phone).
    const grids = [...document.querySelectorAll('[data-library-grid]')];
    expect(grids).toHaveLength(2);
    for (const g of grids) expect(g).toHaveClass('grid-cols-3', 'md:grid-cols-6');
    expect(card).toHaveTextContent('Playlist');
    expect(card).not.toHaveTextContent('9 songs');
    expect(document.querySelector('[data-phone-library]')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Filter your library' })).toBeNull();
  });
});

describe('Library page, phone', () => {
  beforeEach(() => {
    state.desktop = false;
  });

  it('shows the new Library: system collections first, then the playlists, pinned on top', () => {
    state.pinned = ['p2'];
    render(<LibraryPage />);
    expect(document.querySelector('[data-phone-library]')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your collections' })).toBeNull();
    expect(titles()).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'Gym', 'Road Trip']);
    fireEvent.click(document.querySelector('[data-library-item="playlist:p1"]')!);
    expect(state.onOpen).toHaveBeenCalledWith('p1');
  });

  it('+ menu: New playlist opens the create dialog, Start a carlist the start dialog, Import the Transfer flow', () => {
    render(<LibraryPage />);
    expect(screen.queryByRole('menuitem')).toBeNull();
    fromPlus(/New playlist/);
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument();
    fromPlus(/Start a carlist/);
    expect(screen.getByRole('dialog', { name: 'Start a carlist' })).toBeInTheDocument();
    fromPlus(/Import/);
    expect(state.push).toHaveBeenCalledWith(LIBRARY_IMPORT_HREF);
    expect(LIBRARY_IMPORT_HREF).toBe('/transfer?from=%2Flibrary');
  });

  it('with a carlist live, the carlist item opens it instead of the start dialog', () => {
    state.carlist = { id: 's9' };
    render(<LibraryPage />);
    fromPlus(/Open your carlist/);
    expect(state.push).toHaveBeenCalledWith('/session/s9');
    expect(screen.queryByRole('dialog', { name: 'Start a carlist' })).toBeNull();
  });

  it('the empty card\'s Create playlist opens the same create dialog', () => {
    state.playlists = [];
    state.downloaded = new Set();
    render(<LibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create playlist' }));
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument();
  });

  it('the list or grid choice is remembered on this device', () => {
    const first = render(<LibraryPage />);
    // The standard 3-across grid is the default.
    expect(document.querySelector('[data-library-view="grid"]')).toHaveClass('grid-cols-3');
    fireEvent.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(document.querySelector('[data-library-view="list"]')).not.toBeNull();
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe('list');
    first.unmount();
    resetLibraryViewMemory();
    render(<LibraryPage />);
    expect(document.querySelector('[data-library-view="list"]')).not.toBeNull();
  });

  it('offline keeps the Downloaded shelf', () => {
    state.online = false;
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { name: 'Downloaded' })).toBeInTheDocument();
    expect(document.querySelector('[data-phone-library]')).toBeNull();
  });

  it('desktop with no playlists: an icon, a title and New playlist opens the create dialog', () => {
    state.desktop = true;
    state.playlists = [];
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { name: 'No playlists yet' })).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    // By its text: the header's + is an aria-label of the same name.
    fireEvent.click(screen.getByText('New playlist'));
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument();
  });

  it('offline with nothing downloaded: an icon and the honest way, and no button that cannot work', () => {
    state.online = false;
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { name: 'No downloaded playlists' })).toBeInTheDocument();
    expect(screen.getByText(/Go online and tap/)).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
