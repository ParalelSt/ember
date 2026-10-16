import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { AdminInvite } from '@/lib/api';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
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
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminInvites: () => ({ data: state.invites, isLoading: false }),
  useExecuteAddAdminInvite: () => ({ mutateAsync: state.add, isPending: false }),
  useExecuteDeleteAdminInvite: () => ({ mutateAsync: vi.fn() }),
}));

const { default: AdminInvitesPage } = await import('./page');

beforeEach(() => {
  state.desktop = true;
  state.invites = [{ id: 'i1', email: 'sam@example.com', created: '2026-10-01' } as AdminInvite];
  state.add.mockClear();
});

describe('AdminInvitesPage on desktop', () => {
  it('keeps the add form across the top and no floating button', async () => {
    const { container } = render(<AdminInvitesPage />);
    const form = container.querySelector('form')!;
    expect(form).toHaveClass('md:flex');
    expect(container.querySelector('[data-fab]')).toBeNull();
    fireEvent.change(within(form).getByPlaceholderText('email@example.com'), { target: { value: 'new@example.com' } });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    });
    expect(state.add).toHaveBeenCalledWith('new@example.com');
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
