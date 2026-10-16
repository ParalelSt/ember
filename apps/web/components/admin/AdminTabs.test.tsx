import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/users' }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminUsers: () => ({ data: [{}, {}] }),
  useQueryAdminInvites: () => ({ data: [] }),
  useQueryAdminTracks: () => ({ data: { totalItems: 42 } }),
  useQueryAdminBackups: () => ({ data: { backups: [] } }),
  useQueryAdminNativeLog: () => ({ data: undefined }),
}));
const { AdminTabs } = await import('./AdminTabs');

describe('Admin desktop subnav', () => {
  it('is vertical from md and links every section with icons and known counts', () => {
    const { container } = render(<AdminTabs />);
    expect(container.querySelector('nav')).toHaveClass('hidden', 'md:block');
    expect(container.querySelector('ul')).toHaveClass('flex-col');
    const links = screen.getAllByRole('link');
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      '/admin/users', '/admin/invites', '/admin/tracks', '/admin/pranks', '/admin/backups', '/admin/car',
    ]);
    expect(links.every(a => a.querySelector('svg'))).toBe(true);
    expect(links[0]).toHaveTextContent('Users2');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[2]).toHaveTextContent('Tracks42');
    expect(links[5]).toHaveTextContent('Car and Android Auto');
  });
});
