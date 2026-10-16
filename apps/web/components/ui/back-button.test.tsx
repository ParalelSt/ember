import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
const { BackButton, BACK_BUTTON_CLASS } = await import('./back-button');

describe('BackButton', () => {
  it('is a link with the bold arrow when given href', () => {
    render(<BackButton href="/admin" label="Back to Admin" />);
    const link = screen.getByRole('link', { name: 'Back to Admin' });
    expect(link).toHaveAttribute('href', '/admin');
    expect(link).toHaveAttribute('data-slot', 'back-button');
    expect(link.querySelector('.phosphor-arrow-left-bold')).not.toBeNull();
  });

  it('is a button when given onClick', () => {
    const onClick = vi.fn();
    render(<BackButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has one shared look, a phone-sized round hit box', () => {
    render(<BackButton href="/x" className="extra" />);
    const el = screen.getByRole('link', { name: 'Back' });
    for (const c of BACK_BUTTON_CLASS.split(' ')) expect(el).toHaveClass(c);
    expect(el).toHaveClass('size-hit', 'rounded-full', 'extra');
  });
});
