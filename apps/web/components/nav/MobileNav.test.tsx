import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileNav } from './MobileNav';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('MobileNav', () => {
  it('opens search via onSearchClick instead of navigating', () => {
    const onSearchClick = vi.fn();
    render(<MobileNav onSearchClick={onSearchClick} />);

    const event = fireEvent.click(screen.getByRole('link', { name: 'Search' }));

    expect(onSearchClick).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
  });

  it('still navigates on a modified click even with onSearchClick set', () => {
    const onSearchClick = vi.fn();
    render(<MobileNav onSearchClick={onSearchClick} />);

    fireEvent.click(screen.getByRole('link', { name: 'Search' }), { metaKey: true });

    expect(onSearchClick).not.toHaveBeenCalled();
  });

  it('keeps /search as a real href for deep links', () => {
    render(<MobileNav />);
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
  });
});
