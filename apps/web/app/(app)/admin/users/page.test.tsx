import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminUsersPage from './page';
import type { AdminUser } from '@/lib/api';
import { safariDate } from '@/test-utils/safariDate';

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
];

const view = vi.hoisted(() => ({ error: null as Error | null }));
const signOutEverywhere = vi.hoisted(() => vi.fn(async () => ({ ok: true, self: false })));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useAdmin', () => ({
  useExecuteSignOutAdminUserEverywhere: () => ({ mutateAsync: signOutEverywhere }),
  useQueryAdminUsers: () => (view.error ? { data: undefined, isLoading: false, error: view.error } : { data: users, isLoading: false }),
  useExecuteUpdateAdminUser: () => ({ mutate: vi.fn() }),
  useExecuteDeleteAdminUser: () => ({ mutateAsync: vi.fn() }),
  useExecuteResetAdminUserPassword: () => ({ mutateAsync: vi.fn() }),
}));

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
