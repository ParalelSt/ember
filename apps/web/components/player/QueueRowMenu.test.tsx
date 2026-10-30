/** The real track menu under a Next up row: a dropdown on desktop, an
 *  ActionSheet on a phone, and nothing in it may reach the row, which plays
 *  on any click (React sends a portal's clicks up its own tree). */
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueueRowMenu } from './QueueRowMenu';
import { makeTrack } from '@/test-utils/fakeBackend';

const screenSize = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => screenSize.desktop }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div data-testid="dropdown">{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => <button type="button" {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => <button type="button" onClick={onClick}>{children}</button>,
  DropdownMenuLabel: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => {
    const { onClick, 'data-testid': testId } = rest as { onClick?: () => void; 'data-testid'?: string };
    return <div data-testid={testId} onClick={onClick}>{children}</div>;
  },
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/components/track/menus/CreatePlaylistDialog', () => ({
  CreatePlaylistDialog: ({ open }: { open: boolean }) => (open ? <button type="button">in the dialog</button> : null),
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryPlaylists: () => ({ data: [{ id: 'p1', name: 'Mine', role: 'owner' }] }),
  useQueryPlaylistsContaining: () => ({ data: [] }),
  useExecuteAddToPlaylist: () => ({ mutateAsync: vi.fn() }),
  useExecuteCreatePlaylist: () => ({ mutateAsync: vi.fn() }),
}));

const track = makeTrack({ id: 'youtube:x', sourceId: 'x', title: 'Song', artistId: 'some/one' });
const row = vi.fn();
const props = { onPlayNext: vi.fn(), onRemove: vi.fn(), onGoToArtist: vi.fn() };

function show(over: Partial<Parameters<typeof QueueRowMenu>[0]> = {}) {
  return render(
    <div onClick={row}>
      <QueueRowMenu track={track} isNext={false} {...props} {...over} />
    </div>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  screenSize.desktop = true;
});

describe('QueueRowMenu on desktop', () => {
  it('lists Play next, Remove from queue, Go to artist and Add to playlist in the dropdown', () => {
    show();
    expect(screen.getByTestId('dropdown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Play next/ }));
    expect(props.onPlayNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Remove from queue/ }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Go to artist/ }));
    expect(props.onGoToArtist).toHaveBeenCalledWith('/artist/some%2Fone');
    expect(screen.getByText('Add to playlist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mine/ })).toBeInTheDocument();
    expect(row).not.toHaveBeenCalled();
  });

  it('the new playlist dialog does not reach the row', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /New playlist/ }));
    fireEvent.click(screen.getByRole('button', { name: 'in the dialog' }));
    expect(row).not.toHaveBeenCalled();
  });

  it('leaves out what does not apply: Play next when already next, Go to artist with none, Add for a dead song', () => {
    show({
      isNext: true,
      track: makeTrack({ id: 'youtube:y', sourceId: 'y', title: 'Dead', artistId: null, unavailableAt: '2026-10-01T10:00:00Z' }),
    });
    expect(screen.queryByRole('button', { name: /Play next/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Go to artist/ })).toBeNull();
    expect(screen.queryByText('Add to playlist')).toBeNull();
    expect(screen.getByRole('button', { name: /Remove from queue/ })).toBeInTheDocument();
  });
});

describe('QueueRowMenu on a phone', () => {
  beforeEach(() => {
    screenSize.desktop = false;
  });
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'More' }));

  it('is an ActionSheet, opened without playing the song', () => {
    show();
    expect(screen.queryByTestId('action-sheet')).toBeNull();
    open();
    expect(screen.getByTestId('action-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('dropdown')).toBeNull();
    expect(row).not.toHaveBeenCalled();
  });

  it('runs the action and closes', () => {
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: /Remove from queue/ }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('action-sheet')).toBeNull();
    expect(row).not.toHaveBeenCalled();
  });

  it('Add to playlist opens the existing list inside the sheet', () => {
    show();
    open();
    fireEvent.click(screen.getByTestId('sheet-add-to-playlist'));
    expect(screen.getByRole('button', { name: /New playlist/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mine/ })).toBeInTheDocument();
    expect(row).not.toHaveBeenCalled();
  });

  it('a click anywhere in the menu\'s tree stops short of the row', () => {
    show();
    fireEvent.click(screen.getByTestId('queue-row-menu'));
    expect(row).not.toHaveBeenCalled();
  });
});
