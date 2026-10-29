import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { useThemeStore } from '@/stores/useThemeStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
const state = vi.hoisted(() => ({ admin: false, path: '/settings', replace: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { email: 'mia@example.com' }, name: 'Mia', avatarUrl: '/avatar.png', isAdmin: state.admin }) }));
vi.mock('@/components/settings/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
vi.mock('@/components/settings/BuildStamp', () => ({ BuildStamp: () => null }));
import SettingsIndex from '@/app/(app)/settings/page';
import SettingsLayout from '@/app/(app)/settings/layout';
function setWidth(width: number) {
  act(() => {
    const viewport = window as unknown as { happyDOM?: { setViewport?: (size: { width: number }) => void } };
    viewport.happyDOM?.setViewport?.({ width });
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}
beforeEach(() => {
  setWidth(390); state.admin = false; state.path = '/settings'; state.replace.mockClear();
  useThemeStore.setState({ doc: { v: 1, preset: 'forest' } });
  useOfflineStore.setState({ hydrated: false, totalBytes: 0 });
});
it('opens the picker groups and routes without redirecting phones', () => {
  render(<SettingsIndex />);
  for (const [group, labels] of Object.entries({ Account: ['Profile', 'Devices'], App: ['Appearance', 'Plugins', 'Help', "What's new"], Music: ['Library', 'Downloads', 'Uploads'] })) {
    expect(within(screen.getByRole('list', { name: group })).getAllByRole('link').map(a => a.querySelector('[data-settings-label]')?.textContent)).toEqual(labels);
  }
  expect(screen.getByRole('link', { name: 'Uploads' })).toHaveAttribute('href', '/settings/uploads');
  expect(screen.getByRole('link', { name: "What's new" })).toHaveAttribute('href', '/whats-new');
  expect(state.replace).not.toHaveBeenCalled();
});
it('shows the profile card and Edit link', () => {
  const { container } = render(<SettingsIndex />);
  expect(screen.getByText('Mia')).toBeInTheDocument();
  expect(screen.getByText('mia@example.com')).toBeInTheDocument();
  expect(container.querySelector('img')).toHaveAttribute('src', '/avatar.png');
  expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/settings/profile');
});
it('shows real values only, including hydrated zero and custom theme names', () => {
  render(<SettingsIndex />);
  expect(screen.getByRole('link', { name: 'Appearance Forest' })).toBeInTheDocument();
  for (const name of ['Downloads', 'Plugins', 'Library', 'Help']) expect(screen.getByRole('link', { name }).querySelector('[data-settings-value]')).toBeNull();
  act(() => { useOfflineStore.setState({ hydrated: true, totalBytes: 1048576 }); useThemeStore.setState({ doc: { v: 1, preset: 'ember', name: 'My theme' } }); });
  expect(screen.getByRole('link', { name: /Downloads 1.*MB/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Appearance My theme' })).toBeInTheDocument();
  act(() => useOfflineStore.setState({ totalBytes: 0 }));
  expect(screen.getByRole('link', { name: /Downloads 0/ })).toBeInTheDocument();
});
it('only shows admin routes for admins', () => {
  const { rerender } = render(<SettingsIndex />);
  expect(screen.queryByRole('list', { name: 'Admin' })).not.toBeInTheDocument();
  state.admin = true; rerender(<SettingsIndex />);
  expect(within(screen.getByRole('list', { name: 'Admin' })).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/admin/users', '/admin/invites', '/admin/tracks', '/admin/pranks', '/admin/backups', '/admin/car']);
});
it.each(['profile', 'appearance', 'library', 'downloads', 'uploads', 'plugins', 'devices', 'help'])('frames %s without changing its content', section => {
  state.path = `/settings/${section}`;
  render(<SettingsLayout><input aria-label="Existing content" defaultValue="preserved" /></SettingsLayout>);
  const back = screen.getByRole('link', { name: 'Back to Settings' });
  expect(back).toHaveAttribute('href', '/settings');
  expect(back).toHaveAttribute('data-slot', 'back-button');
  expect(back.parentElement).toHaveClass('lg:hidden');
  // From md up the top bar's back button (lib/nav backRouteFor) takes over.
  expect(back).toHaveClass('md:hidden');
  expect(within(back.parentElement!).getByRole('heading')).toHaveTextContent(new RegExp(section, 'i'));
  expect(screen.getByLabelText('Existing content')).toHaveValue('preserved');
  expect(screen.getByRole('navigation')).toHaveClass('hidden', 'lg:block');
});
it('preserves desktop redirect and has no phone home there', () => {
  setWidth(1280); render(<SettingsIndex />);
  expect(state.replace).toHaveBeenCalledWith('/settings/profile');
  expect(screen.queryByRole('list', { name: 'Account' })).not.toBeInTheDocument();
});
it('has no back control on the home', () => {
  render(<SettingsLayout><SettingsIndex /></SettingsLayout>);
  expect(screen.queryByRole('link', { name: 'Back to Settings' })).not.toBeInTheDocument();
});

it('gives older plain sections phone cards without restyling the redesigned sections', () => {
  state.path = '/settings/profile';
  const { rerender } = render(<SettingsLayout><div data-testid="content">Profile form</div></SettingsLayout>);
  expect(screen.getByTestId('content').parentElement).toHaveClass('max-lg:rounded-lg', 'max-lg:bg-card');
  for (const section of ['uploads', 'plugins', 'devices']) {
    state.path = `/settings/${section}`;
    rerender(<SettingsLayout><div data-testid="content">Original section</div></SettingsLayout>);
    expect(screen.getByTestId('content').parentElement).not.toHaveClass('max-lg:bg-card');
  }
});

it('uses the detected device label and omits unrecognized devices', () => {
  const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 15) Chrome/130.0');
  const view = render(<SettingsIndex />);
  expect(screen.getByRole('link', { name: 'Devices Chrome on Android' })).toBeInTheDocument();
  view.unmount();
  ua.mockReturnValue('unknown');
  render(<SettingsIndex />);
  expect(screen.getByRole('link', { name: 'Devices' }).querySelector('[data-settings-value]')).toBeNull();
  ua.mockRestore();
});

it('keeps the desktop picker out of the phone layout', () => {
  state.path = '/settings/appearance';
  render(<SettingsLayout>Appearance controls</SettingsLayout>);
  const nav = screen.getByRole('navigation');
  expect(nav).toHaveClass('hidden', 'lg:block');
  expect(within(nav).queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to Settings' })).toBeInTheDocument();
});

it.each([900, 1023])('keeps the grouped home and section bar at %ipx', width => {
  setWidth(width);
  const view = render(<SettingsLayout><SettingsIndex /></SettingsLayout>);
  const nav = screen.getByRole('navigation', { name: 'Settings' });
  expect(nav).toHaveClass('hidden', 'lg:block');
  expect(nav.parentElement).toHaveClass('flex-col', 'lg:flex-row');
  expect(within(nav).queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Account' })).toBeInTheDocument();
  expect(state.replace).not.toHaveBeenCalled();
  state.path = '/settings/profile';
  view.rerender(<SettingsLayout>Profile form</SettingsLayout>);
  const back = screen.getByRole('link', { name: 'Back to Settings' });
  expect(back).toHaveAttribute('data-slot', 'back-button');
  expect(back.parentElement).toHaveClass('lg:hidden');
  expect(within(back.parentElement!).getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'Profile' })).not.toBeInTheDocument();
  expect(within(nav).queryByRole('list')).not.toBeInTheDocument();
});

it.each([1024, 1280])('shows the grouped column and content header at %ipx and responds to resizing', width => {
  setWidth(width);
  state.path = '/settings/profile';
  render(<SettingsLayout>Profile form</SettingsLayout>);
  const nav = screen.getByRole('navigation', { name: 'Settings' });
  expect(nav).toHaveClass('hidden', 'lg:block', 'lg:w-80');
  expect(nav.parentElement).toHaveClass('lg:flex-row');
  expect(within(nav).getByRole('list', { name: 'Account' })).toBeInTheDocument();
  const title = screen.getByRole('heading', { level: 2, name: 'Profile' });
  expect(title.parentElement?.querySelector('svg')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Back to Settings' })).not.toBeInTheDocument();
  setWidth(900);
  expect(within(nav).queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to Settings' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'Profile' })).not.toBeInTheDocument();
});
