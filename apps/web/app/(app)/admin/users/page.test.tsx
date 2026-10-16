import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdminUsersPage from './page';
import type { AdminUser } from '@/lib/api';

// @base-ui's Dialog reaches the repo root's hoisted React through its own
// node_modules copy (see app/(app)/dizajn/page.test.tsx); render plain
// elements so this test is about the page's own wiring.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'admin1', email: 'admin@ember.test' } }),
}));

const users: AdminUser[] = [
  { id: 'u1', email: 'robin@ember.test', name: 'Robin', avatarUrl: '/pb/api/files/users/u1/avatar.png', isAdmin: false, created: '2024-01-01' },
  { id: 'admin1', email: 'admin@ember.test', name: '', avatarUrl: null, isAdmin: true, created: '2024-01-01' },
];

const view = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => view.desktop }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role="dialog" data-testid={testId}>{children}</div>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const signOutEverywhere = vi.hoisted(() => vi.fn(async () => ({ ok: true, self: false })));
const updateUser = vi.hoisted(() => vi.fn());
const deleteUser = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useAdmin', () => ({
  useExecuteSignOutAdminUserEverywhere: () => ({ mutateAsync: signOutEverywhere }),
  useQueryAdminUsers: () => ({ data: users, isLoading: false }),
  useExecuteUpdateAdminUser: () => ({ mutate: updateUser }),
  useExecuteDeleteAdminUser: () => ({ mutateAsync: deleteUser }),
  useExecuteResetAdminUserPassword: () => ({ mutateAsync: vi.fn() }),
}));

beforeEach(() => {
  view.desktop = true;
  updateUser.mockReset();
  deleteUser.mockClear();
  signOutEverywhere.mockClear();
});

describe('AdminUsersPage', () => {
  it('renders each user row through the shared Avatar', () => {
    const { container } = render(<AdminUsersPage />);
    // The Avatar's structural classes (see components/primitives/Avatar.tsx).
    expect(container.querySelector('.rounded-full.grid.place-items-center')).not.toBeNull();
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/pb/api/files/users/u1/avatar.png');
    expect(screen.getByText('robin@ember.test')).toBeInTheDocument();
  });

  it('signs a member out everywhere after confirming', async () => {
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign robin@ember.test out everywhere' }));
    expect(screen.getByText('Sign robin@ember.test out everywhere?')).toBeInTheDocument();
    expect(signOutEverywhere).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    });
    expect(signOutEverywhere).toHaveBeenCalledWith('u1');
  });
});

describe('AdminUsersPage on a phone', () => {
  const openMenu = (email: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${email}` }));
    return screen.getByTestId('user-menu-sheet');
  };

  beforeEach(() => { view.desktop = false; });

  it('shows a card per user: picture, name or No name, Admin or Member, email', () => {
    const { container } = render(<AdminUsersPage />);
    const cards = screen.getAllByTestId('user-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Robin');
    expect(cards[0]).toHaveTextContent('Member');
    expect(cards[0]).toHaveTextContent('robin@ember.test');
    expect(cards[0].querySelector('img')).toHaveAttribute('src', '/pb/api/files/users/u1/avatar.png');
    expect(cards[1]).toHaveTextContent('No name');
    expect(cards[1]).toHaveTextContent('Admin');
    expect(screen.getByText('2 users')).toBeInTheDocument();
    // No desktop row controls on the phone.
    expect(screen.queryByRole('button', { name: 'Sign robin@ember.test out everywhere' })).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('filters the cards with the search', () => {
    render(<AdminUsersPage />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), { target: { value: 'robin' } });
    expect(screen.getAllByTestId('user-card')).toHaveLength(1);
  });

  it('opens the actions sheet with all five actions for a member', () => {
    render(<AdminUsersPage />);
    const sheet = openMenu('robin@ember.test');
    expect(within(sheet).getByRole('heading', { name: 'Robin' })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Rename', 'Make admin', 'Reset password', 'Sign out everywhere', 'Delete user',
    ]);
    for (const b of within(sheet).getAllByRole('button')) expect(b).toBeEnabled();
  });

  it('Make admin promotes through the same update call, and closes the sheet', () => {
    render(<AdminUsersPage />);
    fireEvent.click(within(openMenu('robin@ember.test')).getByRole('button', { name: 'Make admin' }));
    expect(updateUser).toHaveBeenCalledWith({ id: 'u1', patch: { isAdmin: true } }, expect.anything());
    expect(screen.queryByTestId('user-menu-sheet')).toBeNull();
  });

  it('Rename saves the new name through the same update call', () => {
    render(<AdminUsersPage />);
    fireEvent.click(within(openMenu('robin@ember.test')).getByRole('button', { name: 'Rename' }));
    const sheet = screen.getByTestId('user-rename-sheet');
    fireEvent.change(within(sheet).getByLabelText('Display name for robin@ember.test'), { target: { value: ' Robin H ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(updateUser).toHaveBeenCalledWith({ id: 'u1', patch: { name: 'Robin H' } }, expect.anything());
    expect(screen.queryByTestId('user-rename-sheet')).toBeNull();
  });

  it('Reset password opens the same reset dialog', () => {
    render(<AdminUsersPage />);
    expect(screen.queryByText('Reset password for robin@ember.test')).toBeNull();
    fireEvent.click(within(openMenu('robin@ember.test')).getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('Reset password for robin@ember.test')).toBeInTheDocument();
  });

  it('Sign out everywhere asks first, then signs them out', async () => {
    render(<AdminUsersPage />);
    fireEvent.click(within(openMenu('robin@ember.test')).getByRole('button', { name: 'Sign out everywhere' }));
    expect(screen.getByText('Sign robin@ember.test out everywhere?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    });
    expect(signOutEverywhere).toHaveBeenCalledWith('u1');
  });

  it('Delete user asks first, then deletes them', async () => {
    render(<AdminUsersPage />);
    fireEvent.click(within(openMenu('robin@ember.test')).getByRole('button', { name: 'Delete user' }));
    expect(screen.getByText('Delete robin@ember.test?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
    });
    expect(deleteUser).toHaveBeenCalledWith('u1');
  });

  it('for yourself, Remove admin and Delete user are disabled', () => {
    render(<AdminUsersPage />);
    const sheet = openMenu('admin@ember.test');
    expect(within(sheet).getByRole('heading', { name: 'admin@ember.test' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Remove admin' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'Delete user' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'Reset password' })).toBeEnabled();
    expect(within(sheet).getByRole('button', { name: 'Sign out everywhere' })).toBeEnabled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete user' }));
    expect(deleteUser).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete admin@ember.test?')).toBeNull();
  });
});
