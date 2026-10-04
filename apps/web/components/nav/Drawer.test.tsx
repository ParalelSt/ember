import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Drawer } from './Drawer';

// next/link and next/navigation read the app router context, which no test
// renders (see components/OnlineOnly.test.tsx for the same shim).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

// Sheet is @base-ui's Dialog, which reaches the repo root's hoisted React
// through its own node_modules copy (see app/(app)/dizajn/page.test.tsx);
// render plain elements so this test is about Drawer's own wiring.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'robin@ember.test' },
    name: 'Robin',
    avatarUrl: '/pb/api/files/users/u1/avatar.png',
    isAdmin: false,
  }),
}));
const playlists = vi.hoisted(() => ({ list: [] as { id: string; name: string }[] }));
vi.mock('@/hooks/useLibrary', () => ({ useQueryPlaylists: () => ({ data: playlists.list }) }));
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

describe('Drawer', () => {
  it('renders the signed-in profile row through the shared Avatar', () => {
    const { container } = render(<Drawer open onOpenChange={() => {}} />);
    // The Avatar's structural classes (see components/primitives/Avatar.tsx).
    expect(container.querySelector('.rounded-full.grid.place-items-center')).not.toBeNull();
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/pb/api/files/users/u1/avatar.png');
    expect(screen.getByText('Robin')).toBeInTheDocument();
  });

  it('30 playlists sit in a shrinkable scroller and every row keeps its height', () => {
    playlists.list = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `Playlist ${i}` }));
    render(<Drawer open onOpenChange={() => {}} />);
    const scroller = screen.getByTestId('playlist-scroller');
    expect(scroller.className).toContain('min-h-0');
    const rows = scroller.querySelectorAll('[data-testid="playlist-nav-row"]');
    expect(rows).toHaveLength(30);
    rows.forEach((r) => expect(r.className).toContain('shrink-0'));
    // The user row stays outside the scroller, at the bottom.
    expect(scroller.contains(screen.getByText('Robin'))).toBe(false);
    playlists.list = [];
  });
});
