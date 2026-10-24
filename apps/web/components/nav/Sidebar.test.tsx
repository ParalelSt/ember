import type { ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
vi.mock('@/hooks/useLibrary', () => ({ useQueryPlaylists: () => ({ data: [] }) }));
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
