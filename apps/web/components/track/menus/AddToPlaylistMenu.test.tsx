import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Track } from '@/types/track';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
    disabled,
  }: PropsWithChildren<{ onClick?: () => void; className?: string; disabled?: boolean }>) => (
    <div role="menuitem" onClick={disabled ? undefined : onClick} className={className} aria-disabled={disabled || undefined}>
      {children}
    </div>
  ),
}));
vi.mock('@/components/track/menus/CreatePlaylistDialog', () => ({ CreatePlaylistDialog: () => null }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const lib = vi.hoisted(() => ({
  addMutateAsync: vi.fn(),
  containing: vi.fn((): { data?: string[] } => ({ data: [] })),
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryPlaylists: () => ({
    data: [
      { id: 'p1', name: 'Mine', role: 'owner' },
      { id: 'p2', name: 'Road trip', role: 'member', collaborative: true, owner_name: 'Olga' },
    ],
  }),
  useQueryPlaylistsContaining: lib.containing,
  useExecuteAddToPlaylist: () => ({ mutateAsync: lib.addMutateAsync }),
  useExecuteCreatePlaylist: () => ({ mutateAsync: vi.fn() }),
}));

const { AddToPlaylistMenu } = await import('./AddToPlaylistMenu');

const track = { id: 'youtube:x', source: 'youtube', sourceId: 'x', title: 'Song', artist: 'A' } as Track;

beforeEach(() => {
  vi.clearAllMocks();
  lib.containing.mockImplementation(() => ({ data: [] }));
  lib.addMutateAsync.mockResolvedValue({ ok: true });
});

describe('AddToPlaylistMenu', () => {
  it('has no Move up / Move down (Edit order replaces them)', () => {
    render(<AddToPlaylistMenu track={track} onRematch={vi.fn()} />);
    expect(screen.queryByRole('menuitem', { name: /Move (up|down)/ })).toBeNull();
  });

  it('lists playlists shared with you as places to add to', () => {
    render(<AddToPlaylistMenu track={track} />);
    expect(screen.getByRole('menuitem', { name: 'Road trip' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Move/ })).toBeNull();
  });

  it('asks which playlists have the song only while the menu is open', () => {
    const { rerender } = render(<AddToPlaylistMenu track={track} open={false} />);
    expect(lib.containing).toHaveBeenLastCalledWith('youtube:x', false);
    rerender(<AddToPlaylistMenu track={track} open />);
    expect(lib.containing).toHaveBeenLastCalledWith('youtube:x', true);
  });

  it('marks a playlist that already has the song as Added, and does not add to it again', () => {
    lib.containing.mockImplementation(() => ({ data: ['p1'] }));
    render(<AddToPlaylistMenu track={track} open />);
    const mine = screen.getByRole('menuitem', { name: /Mine/ });
    expect(mine).toHaveTextContent('Added');
    expect(mine).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(mine);
    expect(lib.addMutateAsync).not.toHaveBeenCalled();
    // The other playlist is still on offer.
    const road = screen.getByRole('menuitem', { name: 'Road trip' });
    expect(road).not.toHaveAttribute('aria-disabled');
    expect(road).not.toHaveTextContent('Added');
  });

  it('adds to a playlist and says so', async () => {
    render(<AddToPlaylistMenu track={track} open />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Road trip' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Added "Song" to Road trip'));
    expect(lib.addMutateAsync).toHaveBeenCalledWith({ id: 'p2', track });
  });

  it('a 409 (already there) is a friendly note, not an error', async () => {
    lib.addMutateAsync.mockRejectedValue(Object.assign(new Error('already in this playlist'), { status: 409 }));
    render(<AddToPlaylistMenu track={track} open />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mine' }));
    await waitFor(() => expect(toast.message).toHaveBeenCalledWith('Already in Mine'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('an older server\'s raw unique-index 400 reads the same', async () => {
    lib.addMutateAsync.mockRejectedValue(
      Object.assign(new Error('Failed to create record. (playlist: Value must be unique.; track: Value must be unique.)'), { status: 400 }),
    );
    render(<AddToPlaylistMenu track={track} open />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mine' }));
    await waitFor(() => expect(toast.message).toHaveBeenCalledWith('Already in Mine'));
  });

  it('any other failure is still an error', async () => {
    lib.addMutateAsync.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    render(<AddToPlaylistMenu track={track} open />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mine' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Couldn\'t add "Song", please try again.'));
    expect(toast.message).not.toHaveBeenCalled();
  });
});
