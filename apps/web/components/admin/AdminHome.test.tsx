import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  desktop: false,
  replace: vi.fn(),
  car: { since: 0, hours: 48, devices: [{ key: 'a' }, { key: 'b' }] } as { since: number; hours: number; devices: { key: string }[] } | undefined,
}));

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminUsers: () => ({ data: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] }),
  useQueryAdminInvites: () => ({ data: [{ id: 'i1' }] }),
  useQueryAdminTracks: () => ({ data: { totalItems: 128, tracks: [] } }),
  useQueryAdminBackups: () => ({ data: { backups: [{}, {}] } }),
  useQueryAdminNativeLog: () => ({ data: state.car }),
}));

const { AdminHome } = await import('./AdminHome');

beforeEach(() => {
  state.desktop = false;
  state.replace.mockReset();
  state.car = { since: 0, hours: 48, devices: [{ key: 'a' }, { key: 'b' }] };
});

describe('AdminHome on a phone', () => {
  it('shows a two-column grid of section tiles linking to each section', () => {
    render(<AdminHome />);
    const grid = screen.getByRole('list', { name: 'Admin sections' });
    expect(grid).toHaveClass('grid', 'grid-cols-2', 'md:hidden');
    const links = within(grid).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/admin/users', '/admin/invites', '/admin/tracks', '/admin/pranks', '/admin/backups', '/admin/car',
    ]);
    expect(links[5]).toHaveTextContent('Car and Android Auto');
    expect(links.every((l) => l.querySelector('svg'))).toBe(true);
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('shows the big counts it knows, nothing for Pranks', () => {
    render(<AdminHome />);
    expect(screen.getByTestId('admin-tile-count-users')).toHaveTextContent('3');
    expect(screen.getByTestId('admin-tile-count-invites')).toHaveTextContent('1');
    expect(screen.getByTestId('admin-tile-count-tracks')).toHaveTextContent('128');
    expect(screen.getByTestId('admin-tile-count-backups')).toHaveTextContent('2');
    expect(screen.getByTestId('admin-tile-count-car')).toHaveTextContent('2devices');
    expect(screen.getByTestId('admin-tile-count-pranks')).toBeEmptyDOMElement();
  });

  it('leaves the Car count out until the device log is in', () => {
    state.car = undefined;
    render(<AdminHome />);
    expect(screen.getByTestId('admin-tile-count-car')).toBeEmptyDOMElement();
  });
});

describe('AdminHome on desktop', () => {
  it('opens Users, as /admin always has, and shows no tiles', () => {
    state.desktop = true;
    render(<AdminHome />);
    expect(state.replace).toHaveBeenCalledWith('/admin/users');
    expect(screen.queryByRole('list', { name: 'Admin sections' })).toBeNull();
  });
});
