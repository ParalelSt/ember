import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LikeButton } from './LikeButton';

describe('LikeButton', () => {
  it('labels itself Like and is unpressed when not liked', () => {
    render(<LikeButton liked={false} onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: 'Like' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('labels itself Unlike and is pressed when liked', () => {
    render(<LikeButton liked onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: 'Unlike' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('fires onToggle', () => {
    const onToggle = vi.fn();
    render(<LikeButton liked={false} onToggle={onToggle} />);
    screen.getByRole('button', { name: 'Like' }).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('sizes the box from the size prop', () => {
    const { rerender } = render(<LikeButton liked={false} onToggle={() => {}} />);
    expect(screen.getByRole('button').className).toContain('h-8 w-8');
    rerender(<LikeButton liked={false} onToggle={() => {}} size="md" />);
    expect(screen.getByRole('button').className).toContain('h-10 w-10');
  });
});
