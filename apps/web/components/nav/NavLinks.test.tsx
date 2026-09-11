import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavLinks } from './NavLinks';
import type { NavItem } from '@/lib/nav';

// next/link reads the app router context, which no test renders. See
// components/OnlineOnly.test.tsx for the same shim.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const items: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/library', label: 'Library', icon: 'library' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

const ACTIVE_CLASS = 'bg-sidebar-accent text-sidebar-accent-foreground';

describe('NavLinks', () => {
  it('renders every item as a link to its href', () => {
    render(<NavLinks items={items} activePath="/" />);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('exact-matches Library so a sub-route does not also highlight it', () => {
    render(<NavLinks items={items} activePath="/library/liked" />);
    expect(screen.getByRole('link', { name: 'Library' }).className).not.toContain(ACTIVE_CLASS);
    expect(screen.getByRole('link', { name: 'Home' }).className).not.toContain(ACTIVE_CLASS);
  });

  it('startsWith-matches Settings so a sub-route keeps it highlighted', () => {
    render(<NavLinks items={items} activePath="/settings/profile" />);
    expect(screen.getByRole('link', { name: 'Settings' }).className).toContain(ACTIVE_CLASS);
  });

  it('marks the exact active path active', () => {
    render(<NavLinks items={items} activePath="/library" />);
    expect(screen.getByRole('link', { name: 'Library' }).className).toContain(ACTIVE_CLASS);
  });

  it('fires onNavigate on click', () => {
    const onNavigate = vi.fn();
    render(<NavLinks items={items} activePath="/" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'Library' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
