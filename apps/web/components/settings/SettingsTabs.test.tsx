import { beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useThemeStore } from '@/stores/useThemeStore';
import { useOfflineStore } from '@/stores/useOfflineStore';

const state = vi.hoisted(() => ({ path: '/settings/profile', admin: false }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: ComponentProps<'a'>) => <a {...rest} href={href} onClick={e => { e.preventDefault(); state.path = String(href); }}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { email: 'mia@example.com' }, name: 'Mia', avatarUrl: '/avatar.png', isAdmin: state.admin }) }));
vi.mock('@/components/settings/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
vi.mock('@/components/settings/BuildStamp', () => ({ BuildStamp: () => null }));
import SettingsLayout from '@/app/(app)/settings/layout';

beforeEach(() => {
  window.innerWidth = 1280;
  window.dispatchEvent(new Event('resize'));
  state.path = '/settings/profile'; state.admin = false;
  useThemeStore.setState({ doc: { v: 1, preset: 'forest' } });
  useOfflineStore.setState({ hydrated: false, totalBytes: 0 });
});

it('shows the shared grouped column, profile card, and real current values', () => {
  render(<SettingsLayout>Profile content</SettingsLayout>);
  const nav = screen.getByRole('navigation');
  for (const group of ['Account', 'App', 'Music']) expect(within(nav).getByRole('list', { name: group })).toBeInTheDocument();
  expect(within(nav).getByText('Mia')).toBeInTheDocument();
  expect(within(nav).getByText('mia@example.com')).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/settings/profile');
  expect(within(nav).getByRole('link', { name: 'Appearance Forest' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
});

it('selects the routed section and frames its content with a tinted icon and title', () => {
  const view = render(<SettingsLayout>Profile content</SettingsLayout>);
  fireEvent.click(screen.getByRole('link', { name: 'Appearance Forest' }));
  view.rerender(<SettingsLayout>Appearance controls</SettingsLayout>);
  const active = screen.getByRole('link', { name: 'Appearance Forest' });
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active).toHaveClass('bg-muted');
  expect(screen.getByRole('link', { name: 'Profile' })).not.toHaveAttribute('aria-current');
  const title = screen.getByRole('heading', { name: 'Appearance' });
  expect(title.parentElement?.querySelector('svg')).toBeInTheDocument();
  expect(title.parentElement).toHaveClass('border-b');
  expect(screen.getByText('Appearance controls')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Back to Settings' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Edit' }));
  view.rerender(<SettingsLayout>Profile content</SettingsLayout>);
  expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
});

it('only exposes the existing protected admin routes to admins', () => {
  const view = render(<SettingsLayout>Content</SettingsLayout>);
  expect(screen.queryByRole('list', { name: 'Admin' })).not.toBeInTheDocument();
  state.admin = true;
  view.rerender(<SettingsLayout>Content</SettingsLayout>);
  expect(within(screen.getByRole('list', { name: 'Admin' })).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/admin/users', '/admin/invites', '/admin/tracks', '/admin/pranks', '/admin/backups', '/admin/car']);
});

it.each(['profile', 'appearance', 'library', 'downloads', 'uploads', 'plugins', 'devices', 'help'])('frames the directly opened %s section without changing its controls', section => {
  state.path = `/settings/${section}`;
  render(<SettingsLayout><input aria-label="Existing control" defaultValue="preserved" /></SettingsLayout>);
  const title = screen.getByRole('heading', { name: new RegExp(`^${section}$`, 'i') });
  expect(title.parentElement?.querySelector('svg')).toBeInTheDocument();
  expect(title.parentElement).toHaveClass('border-b');
  expect(screen.getByLabelText('Existing control')).toHaveValue('preserved');
  expect(screen.queryByRole('link', { name: 'Back to Settings' })).not.toBeInTheDocument();
});

it('updates desktop values from the same live stores as the phone', () => {
  render(<SettingsLayout>Content</SettingsLayout>);
  expect(screen.getByRole('link', { name: 'Downloads' }).querySelector('[data-settings-value]')).toBeNull();
  act(() => {
    useOfflineStore.setState({ hydrated: true, totalBytes: 1048576 });
    useThemeStore.setState({ doc: { v: 1, preset: 'ember', name: 'My theme' } });
  });
  expect(screen.getByRole('link', { name: /Downloads 1.*MB/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Appearance My theme' })).toBeInTheDocument();
});

it('scrolls the column with the page: not sticky and no scrollbar of its own', () => {
  render(<SettingsLayout>Content</SettingsLayout>);
  const nav = screen.getByRole('navigation');
  expect(nav).not.toHaveClass('sticky');
  expect(nav.className).not.toMatch(/overflow-y-auto|max-h-/);
});
