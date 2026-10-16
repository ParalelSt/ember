import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
const playlists = vi.hoisted(() => ({ list: [] as { id: string; name: string; track_count?: number; track_artworks?: string[] }[] }));
vi.mock('@/hooks/useLibrary', () => ({ useQueryPlaylists: () => ({ data: playlists.list }), useCachedCollectionTracks: () => ({ heart: [], clock: [{ artworkUrl: '/recent' }], upload: undefined }) }));
vi.mock('@/hooks/useNavPlaylists', () => ({
  useNavPlaylists: (items: unknown[]) => ({ items, onOpen: vi.fn(), onTogglePin: vi.fn() }),
}));
vi.mock('@/hooks/useChangelog', () => ({ useChangelog: () => ({ hasNew: false }) }));
vi.mock('@/hooks/useCreatePlaylistFlow', () => ({
  useCreatePlaylistFlow: () => ({ createOpen: false, setCreateOpen: vi.fn(), handleCreate: vi.fn() }),
}));
vi.mock('@/stores/useUiStore', () => ({ useUiStore: () => vi.fn() }));
vi.mock('@/components/track/menus/CreatePlaylistDialog', () => ({ CreatePlaylistDialog: () => null }));
vi.mock('@/hooks/useImports', () => ({ useImportJobs: () => ({ data: [] }) }));

describe('Sidebar', () => {
  it('renders the signed-in profile row through the shared Avatar', () => {
    const { container } = render(<Sidebar />);
    // The Avatar's structural classes (see components/primitives/Avatar.tsx).
    expect(container.querySelector('.rounded-full.grid.place-items-center')).not.toBeNull();
    const img = container.querySelector('a[href="/settings/profile"] img');
    expect(img).toHaveAttribute('src', '/pb/api/files/users/u1/avatar.png');
    expect(screen.getByText('Robin')).toBeInTheDocument();
  });
});


it('passes cached collection songs and playlist metadata to the shared rows', () => {
  playlists.list = [{ id: 'p1', name: 'Mix', track_count: 4, track_artworks: ['/a', '/b', '/c', '/d'] }];
  render(<Sidebar />);
  expect(screen.getByRole('link', { name: /Liked songs/ })).toHaveTextContent('Playlist · 0 songs');
  const recent = screen.getByRole('link', { name: /Recently played/ });
  expect(recent).toHaveTextContent('Auto playlist · 1 song');
  expect(recent.querySelector('img')).toHaveAttribute('src', '/recent');
  // The upload page lives in Settings now, not in the nav.
  expect(screen.queryByRole('link', { name: /^Uploads/ })).toBeNull();
  const playlist = screen.getByRole('link', { name: /Mix/ });
  expect(playlist).toHaveTextContent('Playlist · 4 songs');
  expect(playlist.querySelectorAll('[data-mosaic] img')).toHaveLength(4);
  playlists.list = [];
});
