import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));

const { ConfirmDialog } = await import('./confirm-dialog');

/** Unhandled rejections seen while a test runs (vitest would only report
 *  them after the run, not against the test). */
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  unhandled.length = 0;
});

describe('ConfirmDialog', () => {
  it('stays open when onConfirm throws, without an unhandled rejection (an automatic bug report)', async () => {
    process.on('unhandledRejection', onUnhandled);
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(async () => {
      throw new Error('server said no');
    });
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete it?" confirmLabel="Delete" onConfirm={onConfirm} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    // Let a rejected handler promise reach the unhandled-rejection hook.
    await new Promise((r) => setTimeout(r, 20));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
    expect(unhandled).toEqual([]);
  });

  it('a destructive confirm gets the risky phone look and a red button', () => {
    render(<ConfirmDialog open onOpenChange={() => {}} variant="destructive" title="Delete it?" confirmLabel="Delete" onConfirm={() => {}} />);
    expect(screen.getByTestId('popup-risky-icon')).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Delete' });
    expect(action.className).toContain('bg-destructive');
    expect(action.className).toContain('max-md:flex-1');
  });

  it('a plain confirm stays plain: no warning icon for something safe', () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Back up now?" confirmLabel="Back up" onConfirm={() => {}} />);
    expect(screen.queryByTestId('popup-risky-icon')).toBeNull();
  });

  it('closes once onConfirm resolves', async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete it?" confirmLabel="Delete" onConfirm={async () => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
