import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueueHeaderActions } from './QueueHeaderActions';

vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));

const onClear = vi.fn();
const onShuffle = vi.fn();
beforeEach(() => vi.clearAllMocks());

const show = (count: number) => render(<QueueHeaderActions count={count} onClear={onClear} onShuffle={onShuffle} />);

describe('QueueHeaderActions', () => {
  it('Clear only acts after the app dialog is confirmed, with the agreed words', async () => {
    show(3);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Next up' }));
    expect(onClear).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Clear Next up?')).toBeInTheDocument();
    expect(within(dialog).getByText('The song playing now keeps playing.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Cancel closes the dialog without clearing', () => {
    show(3);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Next up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Shuffle acts at once, and needs two songs', () => {
    const view = show(2);
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle Next up' }));
    expect(onShuffle).toHaveBeenCalledTimes(1);
    view.unmount();
    show(1);
    expect(screen.getByRole('button', { name: 'Shuffle Next up' })).toBeDisabled();
  });

  it('icons only: shuffle then bin, each titled, round, with an svg and no text', () => {
    show(3);
    const [first, second] = within(screen.getByTestId('queue-header-actions')).getAllByRole('button');
    expect(first).toHaveAttribute('aria-label', 'Shuffle Next up');
    expect(second).toHaveAttribute('aria-label', 'Clear Next up');
    for (const b of [first, second]) {
      expect(b).toHaveAttribute('title', b.getAttribute('aria-label'));
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.textContent).toBe('');
    }
  });

  it('both buttons share one look, and Clear is off with nothing to clear', () => {
    show(0);
    const clear = screen.getByRole('button', { name: 'Clear Next up' });
    const shuffle = screen.getByRole('button', { name: 'Shuffle Next up' });
    expect(clear).toBeDisabled();
    expect(clear.className).toBe(shuffle.className);
    expect(clear).toHaveClass('rounded-full');
  });
});
