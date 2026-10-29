import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { AdminInvite } from '@/lib/api';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div data-testid="dialog-footer">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role="dialog" data-testid={testId}>{children}</div>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const state = vi.hoisted(() => ({
  desktop: true,
  invites: [] as AdminInvite[],
  add: vi.fn(async () => ({ ok: true })),
  error: null as Error | null,
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminInvites: () => (state.error ? { data: undefined, isLoading: false, error: state.error } : { data: state.invites, isLoading: false }),
  useExecuteAddAdminInvite: () => ({ mutateAsync: state.add, isPending: false }),
  useExecuteDeleteAdminInvite: () => ({ mutateAsync: vi.fn() }),
}));

const { default: AdminInvitesPage } = await import('./page');

beforeEach(() => {
  state.desktop = true;
  state.invites = [{ id: 'i1', email: 'sam@example.com', created: '2026-10-01' } as AdminInvite];
  state.add.mockClear();
  state.error = null;
});

describe('AdminInvitesPage on desktop', () => {
  it('opens a header dialog and submits the invite', async () => {
    const { container } = render(<AdminInvitesPage />);
    expect(container.querySelector('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add invite' }));
    const form = screen.getByRole('dialog');
    expect(container.querySelector('[data-fab]')).toBeNull();
    fireEvent.change(within(form).getByPlaceholderText('email@example.com'), { target: { value: 'new@example.com' } });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Add invite' }));
    });
    expect(state.add).toHaveBeenCalledWith('new@example.com');
  });

  it('the dialog\'s Cancel and Add invite sit in the usual footer (popups1)', () => {
    render(<AdminInvitesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add invite' }));
    const footer = screen.getByTestId('dialog-footer');
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: 'Add invite' })).toBeInTheDocument();
  });

  it('says to add one above when there are none', () => {
    state.invites = [];
    render(<AdminInvitesPage />);
    expect(screen.getByText('No invites yet, add one above.')).toBeInTheDocument();
  });
});

describe('AdminInvitesPage on a phone', () => {
  beforeEach(() => { state.desktop = false; });

  it('hides the top add form and shows the floating + button instead', () => {
    const { container } = render(<AdminInvitesPage />);
    expect(container.querySelector('form')).toHaveClass('hidden', 'md:flex');
    const fab = screen.getByRole('button', { name: 'Add invite' });
    expect(fab).toHaveAttribute('data-slot', 'fab');
    expect(fab.querySelector('.phosphor-plus')).not.toBeNull();
    expect(container.querySelector('section')).toHaveClass('pb-stack', 'md:pb-0');
  });

  it('the + opens an Add invite sheet with the email field that adds the invite', async () => {
    render(<AdminInvitesPage />);
    expect(screen.queryByTestId('add-invite-sheet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add invite' }));
    const sheet = screen.getByTestId('add-invite-sheet');
    expect(within(sheet).getByRole('heading', { name: 'Add invite' })).toBeInTheDocument();
    const add = within(sheet).getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText('Email'), { target: { value: ' lena@example.com ' } });
    await act(async () => {
      fireEvent.click(add);
    });
    expect(state.add).toHaveBeenCalledWith('lena@example.com');
    expect(screen.queryByTestId('add-invite-sheet')).toBeNull();
  });

  it('Cancel closes the sheet without adding', () => {
    render(<AdminInvitesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add invite' }));
    fireEvent.click(within(screen.getByTestId('add-invite-sheet')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('add-invite-sheet')).toBeNull();
    expect(state.add).not.toHaveBeenCalled();
  });

  it('points at the + button when there are none', () => {
    state.invites = [];
    render(<AdminInvitesPage />);
    expect(screen.getByText('No invites yet, add one with the + button.')).toBeInTheDocument();
  });
});

it('desktop Cancel closes the invite dialog without submitting', () => {
  render(<AdminInvitesPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Add invite' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.add).not.toHaveBeenCalled();
});

it('desktop keeps the invite dialog open when adding fails', async () => {
  state.add.mockRejectedValueOnce(new Error('Unavailable'));
  render(<AdminInvitesPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Add invite' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add invite' })));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toHaveValue('new@example.com');
});

// It said "No invites yet, add one" on a failed load.
it('says so when the list fails to load, instead of an empty list', () => {
  state.error = new Error('PocketBase is down');
  render(<AdminInvitesPage />);
  expect(screen.getByText(/Couldn.t load invites: PocketBase is down/)).toBeTruthy();
  expect(screen.queryByText(/No invites yet/)).toBeNull();
});
