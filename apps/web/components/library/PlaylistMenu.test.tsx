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
