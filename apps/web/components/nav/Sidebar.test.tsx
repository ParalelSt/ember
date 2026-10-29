import type { ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Sidebar } from './Sidebar';

// next/link and next/navigation read the app router context, which no test
// renders (see components/OnlineOnly.test.tsx for the same shim).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'robin@ember.test' },
    name: 'Robin',
    avatarUrl: '/pb/api/files/users/u1/avatar.png',
    isAdmin: false,
  }),
}));
const lib = vi.hoisted(() => ({
  playlists: [] as { id: string; name: string; artwork_url?: string | null; track_count?: number; track_artworks?: string[] }[],
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryPlaylists: () => ({ data: lib.playlists }),
  useCachedCollectionTracks: () => ({ heart: [], clock: [{ artworkUrl: '/recent' }], upload: undefined }),
}));
vi.mock('@/hooks/useNavPlaylists', () => ({
  useNavPlaylists: (items: unknown[]) => ({ items, onOpen: vi.fn(), onTogglePin: vi.fn(), holdProps: {} }),
}));
vi.mock('@/hooks/useChangelog', () => ({ useChangelog: () => ({ hasNew: false }) }));
vi.mock('@/hooks/useCreatePlaylistFlow', () => ({
  useCreatePlaylistFlow: () => ({ createOpen: false, setCreateOpen: vi.fn(), handleCreate: vi.fn() }),
}));
vi.mock('@/stores/useUiStore', () => ({ useUiStore: () => vi.fn() }));
vi.mock('@/components/track/menus/CreatePlaylistDialog', () => ({ CreatePlaylistDialog: () => null }));
vi.mock('@/hooks/useImports', () => ({ useImportJobs: () => ({ data: [] }) }));

beforeEach(() => {
  lib.playlists = [];
});

describe('Sidebar', () => {
  it('renders the signed-in profile row through the shared Avatar', () => {
    const { container } = render(<Sidebar />);
    // The Avatar's structural classes (see components/primitives/Avatar.tsx).
    expect(container.querySelector('.rounded-full.grid.place-items-center')).not.toBeNull();
    const img = container.querySelector('a[href="/settings/profile"] img');
    expect(img).toHaveAttribute('src', '/pb/api/files/users/u1/avatar.png');
    expect(screen.getByText('Robin')).toBeInTheDocument();
  });

  // A car head unit is 480 to 600px tall: the sidebar scrolls as a whole
  // there instead of cutting off the profile row, and the playlist list
  // keeps a few rows instead of shrinking to nothing.
  it('scrolls as a whole when the window is short, and keeps room for playlists', () => {
    const { container } = render(<Sidebar />);
    const aside = container.querySelector('aside')!;
    expect(aside).toHaveClass('overflow-y-auto');
    expect(aside).not.toHaveClass('overflow-hidden');
    expect(container.querySelector('[data-slot="scroll-area"]')).toHaveClass('flex-1', 'min-h-32');
  });

  it('gives its links touch-sized hit boxes on a touch screen', () => {
    const { container } = render(<Sidebar />);
    expect(container.querySelector('aside')).toHaveClass('touch-hit');
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toMatch(/@media \(pointer: coarse\) \{[^@]*\.touch-hit :is\(button, a\[href\]\)[^@]*inset: min\(0px, calc\(\(100% - 44px\) \/ 2\)\)/);
  });
});

// The owner's pick for a car head unit with the car layout switched off
// (carlayout2, "Covers"): the same links as big rows with big icons, and
// each playlist row with a bigger cover. The redesign gives every sidebar
// covers and song counts; the head unit's only differ in size.
describe('Sidebar, covers look', () => {
  beforeEach(() => {
    lib.playlists = [
      { id: 'p1', name: 'Road trip', artwork_url: '/pb/api/files/playlists/p1/cover.jpg', track_count: 38 },
      { id: 'p2', name: 'Night drive', artwork_url: null, track_count: 24 },
      { id: 'p3', name: 'Single', artwork_url: null, track_count: 1 },
    ];
  });

  it('shows each playlist with its cover and song count, in big rows', () => {
    render(<Sidebar covers />);
    const rows = screen.getAllByTestId('playlist-nav-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Road tripPlaylist · 38 songs',
      'Night drivePlaylist · 24 songs',
      'SinglePlaylist · 1 song',
    ]);
    expect(rows[0].querySelector('img')).toHaveAttribute('src', '/pb/api/files/playlists/p1/cover.jpg');
    expect(rows[0]).toHaveClass('text-base');
    expect(rows[0].firstElementChild).toHaveClass('size-art-sm');
  });

  it('a playlist whose count has not come yet shows no count', () => {
    lib.playlists = [{ id: 'p1', name: 'Road trip', artwork_url: null }];
    render(<Sidebar covers />);
    expect(screen.getAllByTestId('playlist-nav-row')[0].textContent).toBe('Road tripPlaylist');
  });

  it('makes the links big rows with big icons, and the collections cover-sized tiles', () => {
    render(<Sidebar covers />);
    const home = within(screen.getByRole('navigation')).getByRole('link', { name: 'Home' });
    expect(home).toHaveClass('min-h-12', 'text-base', 'font-semibold');
    expect(home.querySelector('svg')).toHaveClass('size-6');
    const liked = screen.getByRole('link', { name: /Liked songs/ });
    expect(liked.firstElementChild).toHaveClass('size-art-sm');
  });

  it('the normal sidebar keeps its small rows', () => {
    render(<Sidebar />);
    const rows = screen.getAllByTestId('playlist-nav-row');
    expect(rows[0]).toHaveClass('text-sm');
    expect(rows[0].firstElementChild).toHaveClass('size-8');
    const home = within(screen.getByRole('navigation')).getByRole('link', { name: 'Home' });
    expect(home).toHaveClass('text-sm');
    expect(home).not.toHaveClass('min-h-12');
  });
});


it('passes cached collection songs and playlist metadata to the shared rows', () => {
  lib.playlists = [{ id: 'p1', name: 'Mix', track_count: 4, track_artworks: ['/a', '/b', '/c', '/d'] }];
  render(<Sidebar />);
  expect(screen.getByRole('link', { name: /Liked songs/ })).toHaveTextContent('Playlist · 0 songs');
  const recent = screen.getByRole('link', { name: /Recently played/ });
  expect(recent).toHaveTextContent('Auto playlist · 1 song');
  expect(recent.querySelector('[data-library-cover="recent"] [data-glyph-tile] svg')).not.toBeNull();
  // The upload page lives in Settings now, not in the nav.
  expect(screen.queryByRole('link', { name: /^Uploads/ })).toBeNull();
  const playlist = screen.getByRole('link', { name: /Mix/ });
  expect(playlist).toHaveTextContent('Playlist · 4 songs');
  expect(playlist.querySelectorAll('[data-mosaic] img')).toHaveLength(4);
  lib.playlists = [];
});

it('spaces the Playlists header with a divider and airier rows (normal sidebar only)', () => {
  lib.playlists = [{ id: 'p1', name: 'Mix', track_count: 4, track_artworks: [] }];
  const { container, unmount } = render(<Sidebar />);
  expect(screen.getByTestId('playlists-header')).toHaveClass('border-t', 'border-sidebar-border', 'mt-block', 'pt-3.5');
  const row = screen.getByTestId('playlist-nav-row');
  expect(row).toHaveClass('py-[7px]');
  expect(row.parentElement).toHaveClass('gap-inset');
  unmount();
  render(<Sidebar covers />);
  const crow = screen.getByTestId('playlist-nav-row');
  expect(crow).not.toHaveClass('py-[7px]');
  expect(crow.parentElement).toHaveClass('gap-0.5');
  void container;
  lib.playlists = [];
});
