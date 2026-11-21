import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CarRail, carRailActive } from './CarRail';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
const path = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.value }));

const onSearch = vi.fn();
beforeEach(() => {
  path.value = '/';
  onSearch.mockClear();
});
const rail = () => render(<CarRail onSearchClick={onSearch} />);

const button = (name: string) => screen.getByRole('link', { name });

describe('CarRail (the head unit car layout, carlayout2 option G)', () => {
  it('has big Home, Search, Radio and Library buttons in that order, then Settings', () => {
    rail();
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual(['Home', 'Search', 'Radio', 'Library', 'Settings']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/', '/search', '/radio', '/library', '/settings']);
    for (const l of links) {
      expect(l).toHaveClass('size-16');
      expect(l.querySelector('svg')).toHaveClass('size-8');
    }
  });

  it('fills the active button in ember, the others stay plain', () => {
    path.value = '/radio';
    rail();
    expect(button('Radio')).toHaveClass('bg-ember', 'text-ember-foreground');
    expect(button('Radio')).toHaveAttribute('aria-current', 'page');
    for (const name of ['Home', 'Search', 'Library', 'Settings']) {
      expect(button(name)).not.toHaveClass('bg-ember');
      expect(button(name)).not.toHaveAttribute('aria-current');
    }
  });

  it('keeps Library lit inside it and on a playlist, Home only on Home', () => {
    expect(carRailActive('/library', '/library/liked')).toBe(true);
    expect(carRailActive('/library', '/playlist/p1')).toBe(true);
    expect(carRailActive('/', '/library')).toBe(false);
    expect(carRailActive('/', '/')).toBe(true);
    expect(carRailActive('/radio', '/radio')).toBe(true);
    expect(carRailActive('/search', '/radio')).toBe(false);
  });

  it('Search opens the search overlay instead of leaving the page', () => {
    rail();
    const ev = fireEvent.click(button('Search'));
    expect(ev).toBe(false); // default prevented
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('is a slim desktop-width rail with touch hit boxes, hidden on a phone width', () => {
    rail();
    expect(screen.getByTestId('car-rail')).toHaveClass('hidden', 'md:flex', 'w-24', 'touch-hit');
  });
});
