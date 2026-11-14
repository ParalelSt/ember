import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { useThemeStore } from '@/stores/useThemeStore';
import { useOfflineStore } from '@/stores/useOfflineStore';

const state = vi.hoisted(() => ({ path: '/settings/profile', admin: false, replace: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: ComponentProps<'a'>) => <a {...rest} href={String(href)}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useRouter: () => ({ replace: state.replace, push: vi.fn() }) }));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'mia@example.com' }, name: 'Mia', avatarUrl: '/avatar.png', isAdmin: state.admin, refresh: vi.fn(), signOut: vi.fn() }),
}));
vi.mock('@/components/settings/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
vi.mock('@/components/settings/BuildStamp', () => ({ BuildStamp: () => null }));
// Sections with their own tests (DevicesSection.test, DownloadsSection.test,
// UploadsSection.test, the appearance page test): stand-ins here.
vi.mock('@/components/settings/appearance/AppearanceEditor', () => ({
  AppearanceEditor: ({ rows }: { rows?: boolean }) => <p>Theme editor{rows ? ' as rows' : ''}</p>,
}));
vi.mock('./DevicesSection', () => ({ DevicesSection: () => <p>Devices rows</p> }));
vi.mock('./DownloadsSection', () => ({ DownloadsSection: () => <p>Downloads rows</p> }));
vi.mock('./UploadsSection', () => ({ UploadsSection: () => <p>Uploads rows</p> }));
vi.mock('@/components/settings/EqualizerPanel', () => ({ EqualizerPanel: () => <div>Equalizer</div> }));
vi.mock('@/components/RequestDialog', () => ({ RequestDialog: () => null }));
vi.mock('@/hooks/useBlockedTracks', () => ({ useBlockedTracks: () => ({ blocked: [], unblock: vi.fn() }) }));
vi.mock('@/hooks/useDesktopPlugins', () => ({ useDesktopPlugins: () => true }));
vi.mock('@/hooks/usePartyEligible', () => ({ usePartyEligible: () => true }));
import SettingsLayout from '@/app/(app)/settings/layout';

const SECTIONS = ['Account', 'Devices', 'Appearance', 'Plugins', 'Library', 'Downloads', 'Uploads', 'Help'];

function setWidth(width: number) {
  act(() => {
    const viewport = window as unknown as { happyDOM?: { setViewport?: (size: { width: number }) => void } };
    viewport.happyDOM?.setViewport?.({ width });
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}
const open = (path: string) => {
  state.path = path;
  return render(<SettingsLayout>Routed page</SettingsLayout>);
};

beforeEach(() => {
  localStorage.clear();
  setWidth(1280);
  state.path = '/settings/profile';
  state.admin = false;
  state.replace.mockClear();
  useThemeStore.setState({ doc: { v: 1, preset: 'forest' } });
  useOfflineStore.setState({ hydrated: true, totalBytes: 1048576 });
});

describe('desktop settings: menu column (layout A, rows C, edit A)', () => {
  it('shows a sidebar-style menu and one heading for the open section, with no design switcher', () => {
    open('/settings/profile');
    expect(document.querySelector('[data-settings-layout="menu"]')).not.toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([...SECTIONS, "What's new"]);
    const active = within(nav).getByRole('link', { name: 'Account' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveClass('bg-ember/14');
    expect(active.querySelector('svg')).toHaveClass('text-ember');
    expect(within(nav).getByRole('link', { name: 'Devices' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: "What's new" })).toHaveAttribute('href', '/whats-new');
    // Settings once, the section once: no icon header repeating it.
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Account']);
    expect(screen.queryByText('Routed page')).toBeNull();
    expect(screen.queryByTestId('design-preview')).toBeNull();
    expect(screen.queryByText('Design preview')).toBeNull();
    // Rows C: groups without lines or cards. Edit A: no Save button anywhere.
    const group = document.querySelector('[data-settings-group]')!;
    expect(group).toHaveClass('flex-col', 'gap-cluster');
    expect(group).not.toHaveClass('divide-y');
    expect(group).not.toHaveClass('bg-card');
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit username' })).toBeNull();
  });

  it('opens Account from /settings', () => {
    open('/settings');
    expect(state.replace).toHaveBeenCalledWith('/settings/profile');
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
  });

  it('opens Account for an unknown section', () => {
    open('/settings/nothing-here');
    expect(state.replace).toHaveBeenCalledWith('/settings/profile');
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
  });

  it.each([
    ['devices', 'Devices', 'Devices rows', 'max-w-3xl'],
    ['downloads', 'Downloads', 'Downloads rows', 'max-w-3xl'],
    ['uploads', 'Uploads', 'Uploads rows', 'max-w-3xl'],
    ['appearance', 'Appearance', 'Theme editor as rows', 'max-w-5xl'],
  ])('draws /settings/%s as its rows section under the one heading', (id, label, body, width) => {
    open(`/settings/${id}`);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([label]);
    expect(screen.getByText(body)).toBeInTheDocument();
    const section = document.querySelector(`[data-settings-section-body="${id}"]`)!;
    expect(section).toHaveClass(width);
    expect(section.className).not.toContain(':hidden');
    expect(document.querySelectorAll('[data-settings-section-body]')).toHaveLength(1);
  });

  it('adds Admin for admins only', () => {
    const view = open('/settings/help');
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    state.admin = true;
    view.rerender(<SettingsLayout>Routed page</SettingsLayout>);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('ignores the old design preview URL params and anything stored by it', () => {
    localStorage.setItem('ember:settings-design-preview', JSON.stringify({ layout: 'D', rows: 'A', edit: 'B' }));
    window.history.replaceState(null, '', '/settings/profile?settings=B&rows=A&edit=C');
    open('/settings/profile');
    expect(document.querySelector('[data-settings-layout="menu"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-settings-section-body]')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit username' })).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    window.history.replaceState(null, '', '/');
  });
});

it('keeps phones and narrow windows on the old layout', () => {
  setWidth(900);
  open('/settings/profile');
  expect(screen.getByText('Routed page')).toBeInTheDocument();
  expect(document.querySelector('[data-settings-layout]')).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull();
});
