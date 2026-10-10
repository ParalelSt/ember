import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HeaderIconButton } from './HeaderIconButton';

describe('HeaderIconButton', () => {
  it('is a 44px squircle with the label, themed fills, and still clickable', () => {
    const onClick = vi.fn();
    render(
      <HeaderIconButton aria-label="Upload songs" onClick={onClick}>
        <svg />
      </HeaderIconButton>,
    );
    const btn = screen.getByRole('button', { name: 'Upload songs' });
    expect(btn).toHaveAttribute('data-shape', 'squircle');
    for (const c of ['size-11', 'rounded-[32%]', 'bg-secondary', 'hover:bg-accent', 'active:text-ember']) {
      expect(btn.className).toContain(c);
    }
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
