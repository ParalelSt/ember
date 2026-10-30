import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Switch } from './switch';

describe('Switch', () => {
  it('is a switch with aria-checked and flips on click', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Thing" id="t" />);
    const sw = screen.getByRole('switch', { name: 'Thing' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAttribute('id', 't');
    expect(sw.className).toContain('bg-muted');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('is ember when on and reports false on the next click', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} aria-label="Thing" />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw.className).toContain('bg-ember');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('does nothing when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} disabled onCheckedChange={onCheckedChange} aria-label="Thing" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('outline variant uses the bordered card track when off', () => {
    render(<Switch checked={false} variant="outline" onCheckedChange={() => {}} aria-label="Thing" />);
    expect(screen.getByRole('switch').className).toContain('border-border');
  });
});
