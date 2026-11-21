import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayButton } from './PlayButton';

describe('PlayButton', () => {
  it('defaults its aria-label to Play', () => {
    render(<PlayButton />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('takes a custom label', () => {
    render(<PlayButton label="Play album" />);
    expect(screen.getByRole('button', { name: 'Play album' })).toBeInTheDocument();
  });

  it('labels itself Pause while playing', () => {
    render(<PlayButton playing />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('keeps a custom label while playing', () => {
    render(<PlayButton playing label="Pause album" />);
    expect(screen.getByRole('button', { name: 'Pause album' })).toBeInTheDocument();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<PlayButton onClick={onClick} />);
    screen.getByRole('button', { name: 'Play' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<PlayButton onClick={onClick} disabled />);
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button).toBeDisabled();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sizes the box from the size prop', () => {
    const { rerender } = render(<PlayButton size="sm" />);
    expect(screen.getByRole('button').className).toContain('h-10 w-10');
    rerender(<PlayButton size="md" />);
    expect(screen.getByRole('button').className).toContain('h-12 w-12');
  });
});
