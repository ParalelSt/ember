import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
}));

const screenSize = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => screenSize.desktop }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

const { PlaylistMenu } = await import('./PlaylistMenu');

function setup(role: 'owner' | 'member') {
  const handlers = { onCollaborate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onLeave: vi.fn() };
  render(<PlaylistMenu role={role} {...handlers} />);
  const items = screen.getAllByRole('menuitem').map((i) => i.textContent?.trim());
  return { handlers, items };
}

describe('PlaylistMenu', () => {
  it('the owner: Collaborate, Rename, Delete, and no Leave', () => {
    const { handlers, items } = setup('owner');
    expect(items).toEqual(['Collaborate', 'Rename', 'Delete playlist']);
    fireEvent.click(screen.getByRole('menuitem', { name: /Collaborate/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete playlist/ }));
    expect(handlers.onCollaborate).toHaveBeenCalledTimes(1);
    expect(handlers.onRename).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it('a member: who can edit and Leave, never Rename or Delete', () => {
    const { handlers, items } = setup('member');
    expect(items).toEqual(['Who can edit', 'Leave playlist']);
    fireEvent.click(screen.getByRole('menuitem', { name: /Leave playlist/ }));
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });
});

describe('PlaylistMenu on a phone (popups1: a sheet from the bottom)', () => {
  it('opens a sheet named after the playlist, and a row runs and closes it', () => {
    screenSize.desktop = false;
    const handlers = { onCollaborate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onLeave: vi.fn() };
    render(<PlaylistMenu role="owner" name="Gym Songs" {...handlers} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Playlist options' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Gym Songs');
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim()).filter(Boolean)).toEqual([
      'Collaborate',
      'Rename',
      'Delete playlist',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
    expect(handlers.onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    screenSize.desktop = true;
  });
});
