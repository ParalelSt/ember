import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { AdminUser } from '@/lib/api';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled, variant }: PropsWithChildren<{ onClick?: () => void; disabled?: boolean; variant?: string }>) => (
    <button role="menuitem" disabled={disabled} data-variant={variant} onClick={onClick}>
      {children}
    </button>
  ),
}));

const screenSize = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => screenSize.desktop }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, 'data-testid': testId }: PropsWithChildren<{ 'data-testid'?: string }>) => (
    <div role="dialog" data-testid={testId}>
      {children}
    </div>
  ),
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div data-testid="rename-dialog">{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

const { UserTable } = await import('./UserTable');

const robin: AdminUser = { id: 'u1', email: 'robin@ember.test', name: 'Robin', avatarUrl: null, isAdmin: false, created: '2024-01-01' };
const me: AdminUser = { id: 'admin1', email: 'admin@ember.test', name: '', avatarUrl: null, isAdmin: true, created: '2024-01-01' };

function setup() {
  const actions = {
    onRename: vi.fn(),
    onToggleAdmin: vi.fn(),
    onDelete: vi.fn(),
    onResetPassword: vi.fn(),
    onSignOutEverywhere: vi.fn(),
  };
  render(<UserTable users={[robin, me]} actorId="admin1" {...actions} />);
  return actions;
}

afterEach(() => {
  screenSize.desktop = true;
});

describe('UserTable on desktop', () => {
  it('each row is a dropdown with every action; Delete user in red; own role and delete disabled', () => {
    const actions = setup();
    expect(screen.queryByTestId('action-sheet')).toBeNull();
    const [robinRow, meRow] = screen.getAllByRole('row').slice(1);
    expect(within(robinRow).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Rename',
      'Make admin',
      'Reset password',
      'Sign out everywhere',
      'Delete user',
    ]);
    expect(within(robinRow).getByRole('menuitem', { name: 'Delete user' })).toHaveAttribute('data-variant', 'destructive');
    expect(within(meRow).getByRole('menuitem', { name: 'Remove admin' })).toBeDisabled();
    expect(within(meRow).getByRole('menuitem', { name: 'Delete user' })).toBeDisabled();

    fireEvent.click(within(robinRow).getByRole('menuitem', { name: 'Make admin' }));
    fireEvent.click(within(robinRow).getByRole('menuitem', { name: 'Reset password' }));
    fireEvent.click(within(robinRow).getByRole('menuitem', { name: 'Sign out everywhere' }));
    fireEvent.click(within(robinRow).getByRole('menuitem', { name: 'Delete user' }));
    expect(actions.onToggleAdmin).toHaveBeenCalledWith(robin, true);
    expect(actions.onResetPassword).toHaveBeenCalledWith(robin);
    expect(actions.onSignOutEverywhere).toHaveBeenCalledWith(robin);
    expect(actions.onDelete).toHaveBeenCalledWith(robin);
    fireEvent.click(within(robinRow).getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByTestId('rename-dialog')).toBeInTheDocument();
  });
});

describe('UserTable on a phone (popups1: a sheet from the bottom)', () => {
  const openFor = (email: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${email}` }));
    return screen.getByTestId('action-sheet');
  };

  it('opens a sheet with the user on top; each row runs its action and closes the sheet', () => {
    screenSize.desktop = false;
    const actions = setup();
    expect(screen.queryByRole('menuitem')).toBeNull();
    const sheet = openFor('robin@ember.test');
    expect(within(sheet).getByRole('heading')).toHaveTextContent('Robin actions');
    expect(sheet).toHaveTextContent('Robin');
    expect(sheet).toHaveTextContent('robin@ember.test');
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Rename',
      'Make admin',
      'Reset password',
      'Sign out everywhere',
      'Delete user',
    ]);
    expect(screen.getByTestId('user-menu-delete')).toHaveClass('text-destructive');

    fireEvent.click(screen.getByTestId('user-menu-admin'));
    expect(actions.onToggleAdmin).toHaveBeenCalledWith(robin, true);
    expect(screen.queryByTestId('action-sheet')).toBeNull();

    openFor('robin@ember.test');
    fireEvent.click(screen.getByTestId('user-menu-reset'));
    expect(actions.onResetPassword).toHaveBeenCalledWith(robin);
    openFor('robin@ember.test');
    fireEvent.click(screen.getByTestId('user-menu-sign-out'));
    expect(actions.onSignOutEverywhere).toHaveBeenCalledWith(robin);
    openFor('robin@ember.test');
    fireEvent.click(screen.getByTestId('user-menu-delete'));
    expect(actions.onDelete).toHaveBeenCalledWith(robin);

    openFor('robin@ember.test');
    fireEvent.click(screen.getByTestId('user-menu-rename'));
    expect(screen.queryByTestId('action-sheet')).toBeNull();
    expect(screen.getByTestId('rename-dialog')).toBeInTheDocument();
  });

  it('for yourself: No name on top, and Remove admin and Delete user are disabled', () => {
    screenSize.desktop = false;
    const actions = setup();
    const sheet = openFor('admin@ember.test');
    expect(sheet).toHaveTextContent('No name');
    expect(sheet).toHaveTextContent('admin@ember.test');
    expect(screen.getByTestId('user-menu-admin')).toHaveTextContent('Remove admin');
    expect(screen.getByTestId('user-menu-admin')).toBeDisabled();
    expect(screen.getByTestId('user-menu-delete')).toBeDisabled();
    fireEvent.click(screen.getByTestId('user-menu-delete'));
    expect(actions.onDelete).not.toHaveBeenCalled();
  });
});
