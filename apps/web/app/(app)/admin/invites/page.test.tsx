import type { PropsWithChildren } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Render the base-ui Dialog as plain elements so this test is about the
// page's own wiring.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const state = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminInvites: () => (state.error ? { data: undefined, isLoading: false, error: state.error } : { data: [], isLoading: false }),
  useExecuteAddAdminInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExecuteDeleteAdminInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: AdminInvitesPage } = await import('./page');

beforeEach(() => {
  state.error = null;
});

// It said "No invites yet, add one" on a failed load.
it('says so when the list fails to load, instead of an empty list', () => {
  state.error = new Error('PocketBase is down');
  render(<AdminInvitesPage />);
  expect(screen.getByText(/Couldn.t load invites: PocketBase is down/)).toBeTruthy();
  expect(screen.queryByText(/No invites yet/)).toBeNull();
});

it('an empty list still invites the first one', () => {
  render(<AdminInvitesPage />);
  expect(screen.getByText(/No invites yet/)).toBeTruthy();
});
