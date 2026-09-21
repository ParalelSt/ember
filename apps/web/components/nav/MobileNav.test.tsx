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
  it('stands off the bottom edge through the one shared safe-area class', () => {
    render(<MobileNav />);
    const nav = screen.getByTestId('mobile-nav');
    // The same class the player bar spends, not a second copy of the same
    // env() string: --safe-bottom is defined once, on :root in globals.css,
    // and is 0 wherever there is no inset at all.
    expect(nav).toHaveClass('safe-area-bottom');
    expect(nav.getAttribute('style')).toBeNull();
    expect(nav).toHaveClass('md:hidden');
  });

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
