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
  playlists: [] as { id: string; name: string; artwork_url: string | null }[],
  counts: undefined as Record<string, number> | undefined,
  countsAsked: [] as boolean[],
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryPlaylists: () => ({ data: lib.playlists }),
  useQueryPlaylistCounts: (enabled: boolean) => {
    lib.countsAsked.push(enabled);
    return { data: enabled ? lib.counts : undefined };
  },
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
  lib.counts = undefined;
  lib.countsAsked = [];
});

describe('Sidebar', () => {
  it('renders the signed-in profile row through the shared Avatar', () => {
    const { container } = render(<Sidebar />);
    // The Avatar's structural classes (see components/primitives/Avatar.tsx).
    expect(container.querySelector('.rounded-full.grid.place-items-center')).not.toBeNull();
    const img = container.querySelector('img');
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
// (carlayout2, "Covers"): the same links as big rows with icons, and each
// playlist with its cover and song count. Only there: phones and computers
// keep the sidebar as it was.
describe('Sidebar, covers look', () => {
  beforeEach(() => {
    lib.playlists = [
      { id: 'p1', name: 'Road trip', artwork_url: '/pb/api/files/playlists/p1/cover.jpg' },
      { id: 'p2', name: 'Night drive', artwork_url: null },
      { id: 'p3', name: 'Single', artwork_url: null },
    ];
    lib.counts = { p1: 38, p2: 24, p3: 1 };
  });

  it('shows each playlist with its cover and song count', () => {
    render(<Sidebar covers />);
    const rows = screen.getAllByTestId('playlist-nav-row');
    expect(rows.map((r) => r.textContent)).toEqual(['Road trip38 songs', 'Night drive24 songs', 'Single1 song']);
    expect(rows[0].querySelector('img')).toHaveAttribute('src', '/pb/api/files/playlists/p1/cover.jpg');
    // No picture: the ember cover placeholder, in the same box.
    expect(rows[1].querySelector('.cover-placeholder')).toHaveClass('size-art-sm');
    expect(lib.countsAsked.every(Boolean)).toBe(true);
  });

  it('a playlist whose count has not come yet shows just its name', () => {
    lib.counts = undefined;
    render(<Sidebar covers />);
    expect(screen.getAllByTestId('playlist-nav-row')[0].textContent).toBe('Road trip');
  });

  it('makes the links big rows with big icons, and the collections cover-sized tiles', () => {
    render(<Sidebar covers />);
    const home = within(screen.getByRole('navigation')).getByRole('link', { name: 'Home' });
    expect(home).toHaveClass('min-h-12', 'text-base', 'font-semibold');
    expect(home.querySelector('svg')).toHaveClass('size-6');
    const liked = screen.getByRole('link', { name: 'Liked songs' });
    expect(within(liked).getByText('Liked songs').previousElementSibling).toHaveClass('size-art-sm');
  });

  it('the normal sidebar stays as it was: text rows, no covers, no counts asked for', () => {
    render(<Sidebar />);
    const rows = screen.getAllByTestId('playlist-nav-row');
    expect(rows.map((r) => r.textContent)).toEqual(['Road trip', 'Night drive', 'Single']);
    expect(rows[0].querySelector('img')).toBeNull();
    const home = within(screen.getByRole('navigation')).getByRole('link', { name: 'Home' });
    expect(home).toHaveClass('text-sm');
    expect(home).not.toHaveClass('min-h-12');
    expect(lib.countsAsked.some(Boolean)).toBe(false);
  });
});
