import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));

const { PasswordResetDialog } = await import('./password-reset-dialog');

// Bughunt V13: a long email in the title ran under the close X in the corner.
describe('PasswordResetDialog', () => {
  it('keeps a long email in the title clear of the close button, wrapping it', () => {
    const email = 'a.really.long.member.address.that.goes.on@example-domain-of-some-length.test';
    render(<PasswordResetDialog open onOpenChange={() => {}} targetEmail={email} isSelfReset={false} onSubmit={vi.fn(async () => {})} />);
    const title = screen.getByText(`Reset password for ${email}`);
    expect(title).toHaveClass('pr-stack', 'break-words');
  });
});

describe('PasswordResetDialog failed save', () => {
  it('stays open when onSubmit throws, without an unhandled rejection (Save and Enter)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const onOpenChange = vi.fn();
      const onSubmit = vi.fn(async () => {
        throw new Error('server said no');
      });
      render(<PasswordResetDialog open onOpenChange={onOpenChange} targetEmail="a@b.test" isSelfReset={false} onSubmit={onSubmit} />);
      const input = screen.getByPlaceholderText(/New password/);
      fireEvent.change(input, { target: { value: 'long enough password' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      await new Promise((r) => setTimeout(r, 20));

      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
