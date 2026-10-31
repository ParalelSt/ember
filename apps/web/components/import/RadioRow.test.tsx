import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// TransferWizard's own dialog and button are base-ui's, which land on the
// repo root's React 18 in a test render (see popoverMock.tsx).
vi.mock('@/components/ui/sheet', () => import('@/test-utils/dialogMock'));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));

import { RadioRow } from './TransferWizard';

function row(on: boolean, onClick = vi.fn()) {
  render(<RadioRow on={on} onClick={onClick} lead={<i />} title="A link" sub="1 minute" />);
  return screen.getByRole('radio', { name: /A link/ });
}

describe('RadioRow', () => {
  it('is a soft filled row: no outline and no radio circle', () => {
    const r = row(false);
    expect(r).toHaveAttribute('aria-checked', 'false');
    expect(r.className).toContain('bg-muted');
    expect(r.className).not.toMatch(/(^|\s)border(\s|-)/);
    expect(r.querySelector('.border-2')).toBeNull();
    expect(within(r).queryByTestId('radio-check')).toBeNull();
  });

  it('the chosen row has a soft ember fill and an ember check on the right', () => {
    const r = row(true);
    expect(r).toHaveAttribute('aria-checked', 'true');
    expect(r.className).toContain('bg-ember/15');
    const check = within(r).getByTestId('radio-check');
    expect(check.parentElement!.className).toContain('text-ember');
    expect(r.lastElementChild).toBe(check.parentElement);
  });

  it('still clicks', () => {
    const onClick = vi.fn();
    fireEvent.click(row(false, onClick));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
