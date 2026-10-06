import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
