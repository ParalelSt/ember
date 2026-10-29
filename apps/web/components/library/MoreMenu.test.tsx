import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dropdown-menu', () => import('@/test-utils/dropdownMenuMock'));

const screenSize = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => screenSize.desktop }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

const { MoreMenu } = await import('./MoreMenu');
const { playlistMenuActions } = await import('./PlaylistMenu');

const handlers = () => ({ onCollaborate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onLeave: vi.fn() });

function open(role: 'owner' | 'member') {
  const h = handlers();
  render(<MoreMenu actions={playlistMenuActions(role, h)} label="Playlist options" name="Gym Songs" />);
  fireEvent.click(screen.getByRole('button', { name: 'Playlist options' }));
  return { h, items: screen.getAllByRole('menuitem').map((i) => i.textContent?.trim()) };
}

describe('playlistMenuActions in the ⋯ menu', () => {
  it('the owner: Collaborate, Rename, Delete, and no Leave', () => {
    const { h, items } = open('owner');
    expect(items).toEqual(['Collaborate', 'Rename', 'Delete playlist']);
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }));
    expect(h.onRename).toHaveBeenCalledTimes(1);
    // The item closes the menu.
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Playlist options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete playlist/ }));
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  it('a member: who can edit and Leave, never Rename or Delete', () => {
    const { h, items } = open('member');
    expect(items).toEqual(['Who can edit', 'Leave playlist']);
    fireEvent.click(screen.getByRole('menuitem', { name: /Leave playlist/ }));
    expect(h.onLeave).toHaveBeenCalledTimes(1);
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('draws nothing with no rows', () => {
    render(<MoreMenu actions={[]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('MoreMenu on a phone (popups1: a sheet from the bottom)', () => {
  it('opens a sheet named after the playlist, and a row runs and closes it', () => {
    screenSize.desktop = false;
    const h = handlers();
    render(<MoreMenu actions={playlistMenuActions('owner', h)} label="Playlist options" name="Gym Songs" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Playlist options' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Gym Songs');
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim()).filter(Boolean)).toEqual([
      'Collaborate',
      'Rename',
      'Delete playlist',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
    expect(h.onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    screenSize.desktop = true;
  });
});
