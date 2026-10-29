import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdminUsersPage from './page';
import type { AdminUser } from '@/lib/api';
import { safariDate } from '@/test-utils/safariDate';

// @base-ui's Dialog reaches the repo root's hoisted React through its own
// node_modules copy (see app/(app)/dizajn/page.test.tsx); render plain
// elements so this test is about the page's own wiring.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));

// Keep page wiring tests independent of the hoisted Base UI React copy.
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react');
  const Context = React.createContext({ open: false, setOpen: (_open: boolean) => {} });
  return {
    DropdownMenu: ({ children }: PropsWithChildren) => {
      const [open, setOpen] = React.useState(false);
      return <Context.Provider value={{ open, setOpen }}>{children}</Context.Provider>;
    },
    DropdownMenuTrigger: ({ children, ...props }: ComponentProps<'button'>) => {
      const { open, setOpen } = React.useContext(Context);
      return <button {...props} onClick={() => setOpen(!open)}>{children}</button>;
    },
    DropdownMenuContent: ({ children }: PropsWithChildren) => React.useContext(Context).open ? <div role="menu">{children}</div> : null,
    DropdownMenuItem: ({ children, disabled, onClick }: ComponentProps<'button'>) => {
      const { setOpen } = React.useContext(Context);
      return <button role="menuitem" disabled={disabled} aria-disabled={disabled || undefined} onClick={e => { onClick?.(e); setOpen(false); }}>{children}</button>;
    },
  };
});

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'admin1', email: 'admin@ember.test' } }),
}));

const users: AdminUser[] = [
  { id: 'u1', email: 'robin@ember.test', name: 'Robin', avatarUrl: '/pb/api/files/users/u1/avatar.png', isAdmin: false, created: '2024-01-01' },
  { id: 'admin1', email: 'admin@ember.test', name: '', avatarUrl: null, isAdmin: true, created: '2024-01-01' },
];

const view = vi.hoisted(() => ({ desktop: true, error: null as Error | null }));
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
  useQueryAdminUsers: () => (view.error ? { data: undefined, isLoading: false, error: view.error } : { data: users, isLoading: false }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Actions for robin@ember.test' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out everywhere' }));
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

describe('desktop users table', () => {
  it('has the supported columns, role tags, fallback name and search', () => {
    render(<AdminUsersPage />);
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['User', 'Email', 'Role', 'Joined', 'Actions']);
    expect(screen.getByText('No name')).toBeInTheDocument();
    expect(screen.queryByText('Last active')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search by email or name…'), { target: { value: 'robin' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });
  it('promotes a member and disables self role and delete actions', () => {
    render(<AdminUsersPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for robin@ember.test' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make admin' }));
    expect(updateUser).toHaveBeenCalledWith({ id: 'u1', patch: { isAdmin: true } }, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Actions for admin@ember.test' }));
    expect(screen.getByRole('menuitem', { name: 'Remove admin' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Delete user' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('desktop user actions reuse phone handlers', () => {
  const pick = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Actions for robin@ember.test' }));
    fireEvent.click(screen.getByRole('menuitem', { name }));
  };
  it('renames from the dialog', () => {
    render(<AdminUsersPage />);
    pick('Rename');
    fireEvent.change(screen.getByLabelText('Display name for robin@ember.test'), { target: { value: ' Robin H ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateUser).toHaveBeenCalledWith({ id: 'u1', patch: { name: 'Robin H' } }, expect.anything());
  });
  it('opens password reset', () => {
    render(<AdminUsersPage />);
    pick('Reset password');
    expect(screen.getByText('Reset password for robin@ember.test')).toBeInTheDocument();
  });
  it('confirms before deleting', async () => {
    render(<AdminUsersPage />);
    pick('Delete user');
    expect(deleteUser).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete user' })));
    expect(deleteUser).toHaveBeenCalledWith('u1');
  });
});

describe('AdminUsersPage Joined date', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    users[0].created = '2024-01-01';
  });

  it('reads the PocketBase format where new Date() cannot (older Safari)', () => {
    users[0].created = '2026-10-23 12:00:00.000Z';
    const want = new Date('2026-10-23T12:00:00.000Z').toLocaleDateString();
    vi.stubGlobal('Date', safariDate());
    render(<AdminUsersPage />);
    expect(screen.queryByText('Invalid Date')).toBeNull();
    expect(screen.getByText(want)).toBeInTheDocument();
  });
});

describe('AdminUsersPage when the list fails to load', () => {
  // It said "No users match." on a failed load, as if nobody had an account.
  afterEach(() => {
    view.error = null;
  });

  it('says so', () => {
    view.error = new Error('PocketBase is down');
    render(<AdminUsersPage />);
    expect(screen.getByText(/Couldn.t load users: PocketBase is down/)).toBeTruthy();
    expect(screen.queryByText('No users match.')).toBeNull();
  });
});
