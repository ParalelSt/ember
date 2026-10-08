import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ImportJob } from '@/lib/import/types';

// The floating pill and the "Transfer done" card in the app shell, with the
// jobs list faked: you stay where you were, the pill says how far, and the
// card says the result and opens the list.

const push = vi.fn();
const nav = vi.hoisted(() => ({ path: '/library/liked' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => nav.path }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const jobsState = vi.hoisted(() => ({ jobs: [] as ImportJob[] }));
const update = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/hooks/useImports', () => ({
  useImportJobs: () => ({ data: jobsState.jobs }),
  useImportActions: () => ({ update }),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));

const { TransferStatus } = await import('./TransferStatus');
const { useTransferStore } = await import('@/stores/useTransferStore');

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: 'j1',
  userId: 'u1',
  kind: 'liked',
  playlistId: null,
  name: 'Liked songs from Spotify',
  source: 'spotify-export',
  sourceUrl: '',
  coverUrl: null,
  status: 'running',
  total: 1200,
  cursor: 300,
  accepted: 280,
  review: 6,
  missing: 2,
  existing: 0,
  error: null,
  retryAt: null,
  dismissed: false,
  ...over,
});

beforeEach(() => {
  nav.path = '/library/liked';
  jobsState.jobs = [];
  push.mockReset();
  toast.mockReset();
  update.mutate.mockReset();
  useTransferStore.setState({ followed: [], notified: [], seen: [] });
});

describe('TransferStatus', () => {
  it('shows nothing without a transfer', () => {
    render(<TransferStatus />);
    expect(screen.queryByTestId('transfer-chip-status')).toBeNull();
  });

  it('a pill floats at the bottom saying how far, and a tap says about how long is left, with Stop', () => {
    jobsState.jobs = [job()];
    render(<TransferStatus />);
    const pill = screen.getByTestId('transfer-pill');
    expect(pill.className).toMatch(/bottom-/);
    expect(pill.className).not.toMatch(/top-/);
    const chip = screen.getByTestId('transfer-chip-status');
    expect(chip).toHaveTextContent('Transferring · 25%');
    expect(screen.getByTestId('transfer-pill-detail')).toHaveTextContent('300 of 1,200');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('transfer-pill-detail')).toHaveTextContent('About 20 minutes left');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(update.mutate).toHaveBeenCalledWith('cancel');
    expect(push).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('a transfer waiting for Retry says why, and offers it', () => {
    jobsState.jobs = [job({ status: 'paused', error: 'YouTube Music is busy.' })];
    render(<TransferStatus />);
    expect(screen.getByTestId('transfer-chip-status')).toHaveTextContent('Transfer paused');
    expect(screen.getByTestId('transfer-pill-detail')).toHaveTextContent('YouTube Music is busy.');
    fireEvent.click(screen.getByTestId('transfer-chip-status'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(update.mutate).toHaveBeenCalledWith('retry');
  });

  it('floats higher on the Transfer page, over its own bottom bar', () => {
    nav.path = '/transfer';
    jobsState.jobs = [job()];
    render(<TransferStatus />);
    expect(screen.getByTestId('transfer-pill').className).toMatch(/bottom-24/);
  });

  it('when it finishes: "Transfer done" with the plain result, and a tap opens the one list', () => {
    jobsState.jobs = [job()];
    const { rerender } = render(<TransferStatus />);
    expect(screen.queryByTestId('transfer-notification')).toBeNull();
    jobsState.jobs = [job({ status: 'done', cursor: 1200, accepted: 1192 })];
    rerender(<TransferStatus />);
    const n = screen.getByTestId('transfer-notification');
    expect(n).toHaveTextContent('Transfer done');
    expect(screen.getByTestId('transfer-notification-result')).toHaveTextContent('We found 1192 songs. 6 need a quick check, 2 we could not find.');
    // The card takes the pill's place while it is up.
    expect(screen.queryByTestId('transfer-chip-status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check 8 songs' }));
    expect(push).toHaveBeenCalledWith('/transfer/review?job=j1');
    expect(screen.queryByTestId('transfer-notification')).toBeNull();
  });

  it('the card itself opens the list too, and once dismissed the pill says how many to check', () => {
    jobsState.jobs = [job()];
    const { rerender } = render(<TransferStatus />);
    jobsState.jobs = [job({ status: 'done', cursor: 1200, accepted: 1192 })];
    rerender(<TransferStatus />);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })));
    expect(screen.getByTestId('transfer-chip-status')).toHaveTextContent('8 to check');
    fireEvent.click(screen.getByTestId('transfer-chip-status'));
    expect(push).toHaveBeenCalledWith('/transfer/review?job=j1');
  });

  it('a stopped transfer says so on its card', () => {
    jobsState.jobs = [job()];
    const { rerender } = render(<TransferStatus />);
    jobsState.jobs = [job({ status: 'cancelled', review: 0, missing: 0 })];
    rerender(<TransferStatus />);
    expect(screen.getByTestId('transfer-notification')).toHaveTextContent('Transfer stopped');
    // Nothing to check: no Check button.
    expect(screen.queryByRole('button', { name: /^Check/ })).toBeNull();
    fireEvent.click(screen.getByText('Transfer stopped'));
    expect(push).toHaveBeenCalledWith('/transfer/review?job=j1');
  });

  it('says it once, even after a reload', () => {
    jobsState.jobs = [job()];
    const first = render(<TransferStatus />);
    jobsState.jobs = [job({ status: 'done' })];
    first.rerender(<TransferStatus />);
    first.unmount();
    render(<TransferStatus />);
    expect(screen.queryByTestId('transfer-notification')).toBeNull();
  });

  it('one started here that finished while the app was closed is said on the next open', () => {
    useTransferStore.setState({ followed: ['j1'] });
    jobsState.jobs = [job({ status: 'done' })];
    render(<TransferStatus />);
    expect(screen.getByTestId('transfer-notification')).toHaveTextContent('Transfer done');
  });

  it('an old finished transfer says nothing, and its chip opens the list', () => {
    jobsState.jobs = [job({ status: 'done' })];
    render(<TransferStatus />);
    expect(screen.queryByTestId('transfer-notification')).toBeNull();
    fireEvent.click(screen.getByTestId('transfer-chip-status'));
    expect(push).toHaveBeenCalledWith('/transfer/review?job=j1');
  });

  it('with nothing to check, the chip goes once the notification is dismissed', () => {
    jobsState.jobs = [job()];
    const { rerender } = render(<TransferStatus />);
    jobsState.jobs = [job({ status: 'done', review: 0, missing: 0 })];
    rerender(<TransferStatus />);
    expect(screen.getByTestId('transfer-notification')).toHaveTextContent('Transfer done');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })));
    expect(screen.queryByTestId('transfer-notification')).toBeNull();
    expect(screen.queryByTestId('transfer-chip-status')).toBeNull();
  });

  it('a new-playlist transfer is followed only when it was started here', () => {
    jobsState.jobs = [job({ kind: 'playlist', playlistId: 'p1' })];
    const { rerender } = render(<TransferStatus />);
    expect(screen.queryByTestId('transfer-chip-status')).toBeNull();
    act(() => useTransferStore.getState().follow('j1'));
    rerender(<TransferStatus />);
    expect(screen.getByTestId('transfer-chip-status')).toBeInTheDocument();
  });

  it('stays out of the way on the list page itself', () => {
    nav.path = '/transfer/review';
    jobsState.jobs = [job({ status: 'done' })];
    render(<TransferStatus />);
    expect(screen.queryByTestId('transfer-chip-status')).toBeNull();
  });
});
