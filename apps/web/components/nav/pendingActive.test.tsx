import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NavLinks } from './NavLinks';
import { MobileNav } from './MobileNav';
import { CarRail } from './CarRail';
import { WhatsNewLink } from '@/components/changelog/WhatsNewLink';
import { resetPendingNav } from '@/lib/pendingNav';
import type { NavItem } from '@/lib/nav';

let path = '/';
vi.mock('next/navigation', () => ({ usePathname: () => path }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const items: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/radio', label: 'Radio', icon: 'radio' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];
const ACTIVE = 'bg-ember/14';

afterEach(() => {
  resetPendingNav();
  path = '/';
  vi.useRealTimers();
});

describe('optimistic active nav item', () => {
  it('NavLinks lights the pressed item at once and dims the old one', () => {
    render(<NavLinks items={items} activePath="/" />);
    expect(screen.getByRole('link', { name: 'Home' }).className).toContain(ACTIVE);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Radio' }));
    expect(screen.getByRole('link', { name: 'Radio' }).className).toContain(ACTIVE);
    expect(screen.getByRole('link', { name: 'Home' }).className).not.toContain(ACTIVE);
  });

  it('a press that is cancelled (a scroll) puts it back', () => {
    render(<NavLinks items={items} activePath="/" />);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Radio' }));
    fireEvent.pointerCancel(screen.getByRole('link', { name: 'Radio' }));
    expect(screen.getByRole('link', { name: 'Home' }).className).toContain(ACTIVE);
  });

  it('a click without a pointer press (keyboard) lights it too', () => {
    render(<NavLinks items={items} activePath="/" />);
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('link', { name: 'Settings' }).className).toContain(ACTIVE);
  });

  it('a modified click (new tab) lights nothing', () => {
    render(<NavLinks items={items} activePath="/" />);
    fireEvent.click(screen.getByRole('link', { name: 'Radio' }), { ctrlKey: true });
    expect(screen.getByRole('link', { name: 'Radio' }).className).not.toContain(ACTIVE);
  });

  it('lets go after 10 seconds', () => {
    vi.useFakeTimers();
    render(<NavLinks items={items} activePath="/" />);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Radio' }));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('link', { name: 'Home' }).className).toContain(ACTIVE);
  });

  it('lets go when the route arrives', () => {
    const { rerender } = render(<NavLinks items={items} activePath="/" />);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Radio' }));
    rerender(<NavLinks items={items} activePath="/radio" />);
    expect(screen.getByRole('link', { name: 'Radio' }).className).toContain(ACTIVE);
    expect(screen.getByRole('link', { name: 'Home' }).className).not.toContain(ACTIVE);
  });

  it('the search item that opens an overlay does not wait on a route', () => {
    const searchItems: NavItem[] = [...items, { href: '/search', label: 'Search', icon: 'search' }];
    render(<NavLinks items={searchItems} activePath="/" onSearchClick={() => {}} />);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Search' }));
    fireEvent.click(screen.getByRole('link', { name: 'Search' }));
    expect(screen.getByRole('link', { name: 'Home' }).className).toContain(ACTIVE);
  });

  it('tapping What\'s new dims the sibling nav items (shared state)', () => {
    render(
      <>
        <NavLinks items={items} activePath="/" />
        <WhatsNewLink showNew={false} activePath="/" />
      </>,
    );
    fireEvent.pointerDown(screen.getByTestId('whats-new-link'));
    expect(screen.getByTestId('whats-new-link').className).toContain(ACTIVE);
    expect(screen.getByRole('link', { name: 'Home' }).className).not.toContain(ACTIVE);
  });

  it('MobileNav lights the pressed tab', () => {
    render(<MobileNav />);
    const lib = screen.getByRole('link', { name: 'Library' });
    expect(lib.className).toContain('text-foreground/55');
    fireEvent.pointerDown(lib);
    expect(lib.className).not.toContain('text-foreground/55');
    expect(screen.getByRole('link', { name: 'Home' }).className).toContain('text-foreground/55');
  });

  it('CarRail lights the pressed button', () => {
    render(<CarRail onSearchClick={() => {}} />);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Radio' }));
    expect(screen.getByRole('link', { name: 'Radio' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });
});
