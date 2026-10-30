import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApplyBar, type ApplyBarProps } from './ApplyBar';

function bar(over: Partial<ApplyBarProps> = {}) {
  const props: ApplyBarProps = {
    dirty: true,
    name: 'Midnight',
    inUseName: 'Ember',
    edited: false,
    canApply: true,
    applying: false,
    onApply: vi.fn(),
    onDiscard: vi.fn(),
    ...over,
  };
  render(<ApplyBar {...props} />);
  return props;
}

describe('ApplyBar, the soft bar', () => {
  it('something to apply: the same text and buttons on a soft block that sticks, no outline', () => {
    const p = bar();
    const el = screen.getByTestId('apply-bar');
    expect(el).toHaveClass('bg-card', 'rounded-[12px]', 'p-row', 'sticky', 'top-0');
    expect(el.className).not.toMatch(/(^|\s)border(-|\s|$)/);
    expect(el).toHaveTextContent('Midnight shows in the preview only.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(p.onApply).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to current' }));
    expect(p.onDiscard).toHaveBeenCalled();
  });

  it('changed colours say so', () => {
    bar({ edited: true });
    expect(screen.getByTestId('apply-bar')).toHaveTextContent('Your changes to Midnight show in the preview only.');
  });

  it('Apply is off while it cannot apply or is applying', () => {
    bar({ canApply: false });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('says Applying while it applies', () => {
    bar({ applying: true });
    expect(screen.getByRole('button', { name: 'Applying' })).toBeDisabled();
  });

  it('nothing to apply: the same soft block names the theme in use, and does not stick', () => {
    bar({ dirty: false });
    const el = screen.getByTestId('in-use-bar');
    expect(el).toHaveClass('bg-card', 'rounded-[12px]', 'p-row');
    expect(el).not.toHaveClass('sticky');
    expect(el).toHaveTextContent('In use: Ember.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
