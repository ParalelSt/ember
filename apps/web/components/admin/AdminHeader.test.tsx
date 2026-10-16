import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ path: '/admin' }));
vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));

const { AdminHeader } = await import('./AdminHeader');
const { adminSectionFor } = await import('./sections');

beforeEach(() => { state.path = '/admin'; });

describe('AdminHeader', () => {
  it('on /admin is just the Admin title, on every size', () => {
    render(<AdminHeader />);
    const title = screen.getByRole('heading', { level: 1, name: 'Admin' });
    expect(title).toHaveClass('text-page-title', 'mb-stack');
    expect(title).not.toHaveClass('hidden');
    expect(screen.queryByTestId('admin-section-bar')).toBeNull();
  });

  it.each([
    ['/admin/users', 'Users'],
    ['/admin/invites', 'Invites'],
    ['/admin/tracks', 'Tracks'],
    ['/admin/pranks', 'Pranks'],
    ['/admin/backups', 'Backups'],
    ['/admin/car', 'Car and Android Auto'],
  ])('in %s a phone gets the section name and a back arrow to the tiles', (path, label) => {
    state.path = path;
    render(<AdminHeader />);
    const bar = screen.getByTestId('admin-section-bar');
    expect(bar).toHaveClass('md:hidden');
    expect(screen.getByRole('heading', { level: 1, name: label })).toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'Back to Admin' });
    expect(back).toHaveAttribute('href', '/admin');
    expect(back).toHaveAttribute('data-slot', 'back-button');
    // Desktop keeps "Admin" over the tabs; it is hidden on the phone only.
    expect(screen.getByRole('heading', { level: 1, name: 'Admin' })).toHaveClass('hidden', 'md:block', 'mb-stack');
  });

  it('matches whole path segments only', () => {
    expect(adminSectionFor('/admin/users/x')?.id).toBe('users');
    expect(adminSectionFor('/admin/usersx')).toBeNull();
    expect(adminSectionFor('/admin')).toBeNull();
  });
});
