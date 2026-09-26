import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '@/types/track';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onClick, className }: PropsWithChildren<{ onClick?: () => void; className?: string }>) => (
    <div role="menuitem" onClick={onClick} className={className}>
      {children}
    </div>
  ),
}));
vi.mock('@/components/track/menus/CreatePlaylistDialog', () => ({ CreatePlaylistDialog: () => null }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryPlaylists: () => ({
    data: [
      { id: 'p1', name: 'Mine', role: 'owner' },
      { id: 'p2', name: 'Road trip', role: 'member', collaborative: true, owner_name: 'Olga' },
    ],
  }),
  useExecuteAddToPlaylist: () => ({ mutateAsync: vi.fn() }),
  useExecuteCreatePlaylist: () => ({ mutateAsync: vi.fn() }),
}));

const { AddToPlaylistMenu } = await import('./AddToPlaylistMenu');

const track = { id: 'youtube:x', source: 'youtube', sourceId: 'x', title: 'Song', artist: 'A' } as Track;

describe('AddToPlaylistMenu', () => {
  it('on a phone it carries Move up / Move down, phone-only', () => {
    const up = vi.fn();
    render(<AddToPlaylistMenu track={track} moves={{ up }} />);
    const item = screen.getByRole('menuitem', { name: /Move up/ });
    expect(item.className).toContain('md:hidden');
    expect(screen.queryByRole('menuitem', { name: /Move down/ })).toBeNull();
    fireEvent.click(item);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('lists playlists shared with you as places to add to', () => {
    render(<AddToPlaylistMenu track={track} />);
    expect(screen.getByRole('menuitem', { name: 'Road trip' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Move/ })).toBeNull();
  });
});
