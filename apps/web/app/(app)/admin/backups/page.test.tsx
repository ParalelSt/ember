import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AdminBackupsPage from './BackupsPanel';
import type { AdminBackupsStatus } from '@/lib/api';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));

const GB = 1024 * 1024 * 1024;

const state = vi.hoisted(() => ({
  data: undefined as AdminBackupsStatus | undefined,
  isLoading: false,
  pending: false,
  mutate: vi.fn(),
  desktop: true,
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));

vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminBackups: () => ({ data: state.data, isLoading: state.isLoading, error: null }),
  useExecuteBackupNow: () => ({ mutate: state.mutate, isPending: state.pending }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base = (): AdminBackupsStatus => ({
  backups: [
    { name: 'pb_backup_ember_20260926120000.zip', size: 5 * 1024 * 1024, modified: '2026-09-26T12:00:00.000Z', auto: false },
    { name: '@auto_pb_backup_ember_20260926040000.zip', size: 4 * 1024 * 1024, modified: '2026-09-26T04:00:00.000Z', auto: true },
  ],
  schedule: { cron: '0 4 * * *', keep: 7, s3: false },
  disk: { free: 120 * GB, total: 500 * GB, low: false },
  memberFiles: { files: 42, bytes: 300 * 1024 * 1024 },
});

beforeEach(() => {
  state.data = base();
  state.isLoading = false;
  state.pending = false;
  state.mutate.mockReset();
  state.desktop = true;
});

describe('AdminBackupsPage', () => {
  it('lists each backup with its size, kind and a download link', () => {
    render(<AdminBackupsPage />);
    const items = within(screen.getByRole('list', { name: 'Database backups' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('pb_backup_ember_20260926120000.zip');
    expect(items[0].textContent).toContain('5.0 MB');
    expect(items[0].textContent).toContain('manual');
    expect(items[1].textContent).toContain('automatic');

    const link = within(items[1]).getByRole('link', { name: 'Download @auto_pb_backup_ember_20260926040000.zip' });
    expect(link.getAttribute('href')).toBe('/api/admin/backups/%40auto_pb_backup_ember_20260926040000.zip');
    expect(link.hasAttribute('download')).toBe(true);
  });

  it('shows the schedule in words and the free disk space', () => {
    render(<AdminBackupsPage />);
    expect(screen.getByTestId('backup-schedule').textContent).toBe(
      'Automatic backups: Every night at 04:00 UTC, keeping the last 7.',
    );
    expect(screen.getByTestId('backup-disk').textContent).toBe('Free disk space: 120.00 GB of 500.00 GB');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns when disk space is low', () => {
    state.data = { ...base(), disk: { free: 1 * GB, total: 500 * GB, low: true } };
    render(<AdminBackupsPage />);
    expect(screen.getByRole('alert').textContent).toMatch(/Disk space is low/);
  });

  it('says plainly when automatic backups are off', () => {
    state.data = { ...base(), schedule: { cron: '', keep: 7, s3: false } };
    render(<AdminBackupsPage />);
    expect(screen.getByTestId('backup-schedule').textContent).toMatch(/Automatic backups are off/);
  });

  it('Back up now runs the mutation and is disabled while it runs', () => {
    const { rerender } = render(<AdminBackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(state.mutate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back up now' }));
    expect(state.mutate).toHaveBeenCalledTimes(1);

    state.pending = true;
    rerender(<AdminBackupsPage />);
    expect(screen.getByRole('button', { name: 'Backing up…' })).toBeDisabled();
  });

  it('offers the member files archive with its size in a short card', () => {
    render(<AdminBackupsPage />);
    const link = screen.getByRole('link', { name: 'Download member files' });
    expect(link.getAttribute('href')).toBe('/api/admin/backups/member-files');
    expect(screen.getByTestId('member-files').textContent).toBe('42 files, 300.0 MB before compression');
    const card = screen.getByRole('heading', { name: 'Member files' }).parentElement!;
    expect(card).toHaveClass('rounded-2xl', 'bg-card', 'p-stack', 'shadow-soft');
    expect(card.querySelector('p')!.textContent!.length).toBeLessThan(180);
  });

  it('has a restore note but no restore button', () => {
    render(<AdminBackupsPage />);
    expect(screen.getByRole('heading', { name: 'Restoring' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
    const steps = screen.getByRole('list', { name: 'Restore steps' });
    expect(steps.tagName).toBe('OL');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(steps.textContent).toMatch(/Upload backup/);
    expect(steps.textContent).toMatch(/MUSIC_DIR/);
    expect(screen.getByRole('link', { name: 'SETUP.md: Backups' })).toHaveAttribute(
      'href', 'https://github.com/ParalelSt/ember/blob/main/SETUP.md#backups',
    );
    expect(document.body.textContent).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)/);
  });

  it('shows an empty state when there are no backups yet', () => {
    state.data = { ...base(), backups: [] };
    render(<AdminBackupsPage />);
    expect(screen.getByText('No backups yet. Make one with Back up now.')).toBeInTheDocument();
  });
});

it('shows when the automatic backup schedule is unavailable', () => {
  state.data = { ...base(), schedule: null };
  render(<AdminBackupsPage />);
  expect(screen.getByTestId('backup-schedule')).toHaveTextContent('Automatic backups: status unavailable.');
});

describe('AdminBackupsPage header button and phone floating pill', () => {
  it('desktop keeps Back up now in the header and has no floating button', () => {
    const { container } = render(<AdminBackupsPage />);
    const header = screen.getByRole('button', { name: 'Back up now' });
    expect(header).toHaveClass('md:inline-flex');
    expect(header.closest('[data-fab]')).toBeNull();
    expect(container.querySelector('[data-fab]')).toBeNull();
  });

  it('a phone gets a floating Back up now pill that runs the backup', () => {
    state.desktop = false;
    const { container } = render(<AdminBackupsPage />);
    // The header button is CSS-hidden below md.
    const header = container.querySelector('button:not([data-fab])')!;
    expect(header).toHaveClass('hidden', 'md:inline-flex');
    const fab = container.querySelector<HTMLButtonElement>('[data-fab]')!;
    expect(fab).toHaveAttribute('data-slot', 'fab');
    expect(fab).toHaveTextContent('Back up now');
    expect(fab).toHaveClass('px-block');
    fireEvent.click(fab);
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(container.querySelector('section')).toHaveClass('pb-stack', 'md:pb-0');
  });

  it('the phone pill is disabled and says so while a backup runs', () => {
    state.desktop = false;
    state.pending = true;
    const { container } = render(<AdminBackupsPage />);
    const fab = container.querySelector('[data-fab]')!;
    expect(fab).toHaveTextContent('Backing up…');
    expect(fab).toBeDisabled();
  });
});

it('desktop Cancel dismisses confirmation without making a backup', () => {
  render(<AdminBackupsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(state.mutate).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
