import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useThemeStore } from '@/stores/useThemeStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { DESIGN_STORAGE_KEY, type SettingsDesign } from './DesignPreview';

const state = vi.hoisted(() => ({ path: '/settings/profile', admin: false, replace: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: ComponentProps<'a'>) => <a {...rest} href={String(href)}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useRouter: () => ({ replace: state.replace, push: vi.fn() }) }));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'mia@example.com' }, name: 'Mia', avatarUrl: '/avatar.png', isAdmin: state.admin, refresh: vi.fn(), signOut: vi.fn() }),
}));
vi.mock('@/components/settings/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
vi.mock('@/components/settings/BuildStamp', () => ({ BuildStamp: () => null }));
// The pages kept whole: stand-ins with the heading the layout hides.
vi.mock('@/app/(app)/settings/appearance/page', () => ({ default: () => <section><h2>Appearance</h2><p>Theme editor</p></section> }));
vi.mock('@/app/(app)/settings/devices/page', () => ({ default: () => <section><h2>Devices</h2><p>Devices panel</p></section> }));
vi.mock('@/app/(app)/settings/downloads/page', () => ({ default: () => <section><header><h2>Downloads</h2></header><p>Downloads list</p></section> }));
vi.mock('@/app/(app)/settings/uploads/page', () => ({ default: () => <section><header><h2>Uploads</h2></header><p>Uploads list</p></section> }));
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
function design(d: Partial<SettingsDesign>) {
  localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify({ layout: 'A', rows: 'A', edit: 'A', ...d }));
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

describe('layout A: settings menu column', () => {
  it('is the default: a sidebar-style menu, one heading for the open section, and the switcher', () => {
    open('/settings/profile');
    expect(document.querySelector('[data-settings-layout="A"]')).not.toBeNull();
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
    expect(screen.getByTestId('design-preview')).toBeInTheDocument();
    // The owner's defaults: rows C, edit A (no Save button anywhere).
    expect(document.querySelector('[data-settings-group]')).toHaveAttribute('data-rows-style', 'C');
    expect(document.querySelector('[data-edit-style="A"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('opens Account from /settings', () => {
    open('/settings');
    expect(state.replace).toHaveBeenCalledWith('/settings/profile');
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
  });

  it('shows a kept page under the one heading, its own first heading marked hidden', () => {
    open('/settings/downloads');
    expect(screen.getByRole('link', { name: 'Downloads' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Downloads list')).toBeInTheDocument();
    const body = document.querySelector('[data-settings-section-body="downloads"]')!;
    expect(body.className).toContain('[&>section:first-child>header>h2:first-child]:hidden');
    expect(body.className).toContain('max-w-3xl');
    expect(document.querySelector('[data-settings-section-body="appearance"]')).toBeNull();
  });

  it('adds Admin for admins only', () => {
    const view = open('/settings/help');
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    state.admin = true;
    view.rerender(<SettingsLayout>Routed page</SettingsLayout>);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });
});

describe('layout B: one long page with tabs', () => {
  it('stacks every section and the tabs scroll to one', () => {
    design({ layout: 'B' });
    open('/settings');
    expect(state.replace).not.toHaveBeenCalled();
    // (The kept pages' own headings are in the DOM too, hidden by CSS.)
    expect([...document.querySelectorAll('h2[id^="settings-"]')].map((h) => h.textContent)).toEqual(SECTIONS);
    const tabs = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(tabs).toHaveClass('sticky');
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(SECTIONS);
    const help = document.getElementById('settings-help')!;
    const scroll = vi.fn();
    help.scrollIntoView = scroll;
    fireEvent.click(within(tabs).getByRole('button', { name: 'Help' }));
    expect(scroll).toHaveBeenCalled();
    expect(within(tabs).getByRole('button', { name: 'Help' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tabs).getByRole('button', { name: 'Account' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Theme editor')).toBeInTheDocument();
    expect(screen.getByText('Report a bug', { selector: 'div' })).toBeInTheDocument();
  });
});

describe('layout C: tabs, one section at a time', () => {
  it('shows only the open tab', () => {
    design({ layout: 'C' });
    open('/settings/help');
    const tabs = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(tabs).getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Plugins' })).toHaveAttribute('href', '/settings/plugins');
    expect(screen.getByRole('region', { name: 'Help' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-settings-section-body]')).toHaveLength(1);
    expect(screen.queryByText('Theme editor')).toBeNull();
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  it('opens Account from /settings', () => {
    design({ layout: 'C' });
    open('/settings');
    expect(state.replace).toHaveBeenCalledWith('/settings/profile');
  });
});

describe('layout D: overview tiles', () => {
  it('opens on tiles with real summaries, without redirecting', () => {
    design({ layout: 'D' });
    open('/settings');
    expect(state.replace).not.toHaveBeenCalled();
    const tiles = screen.getByRole('list', { name: 'Settings sections' });
    expect(within(tiles).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/settings/profile', '/settings/devices', '/settings/appearance', '/settings/plugins', '/settings/library',
      '/settings/downloads', '/settings/uploads', '/settings/help', '/whats-new',
    ]);
    expect(within(tiles).getByRole('link', { name: /Account Mia/ })).toBeInTheDocument();
    expect(within(tiles).getByRole('link', { name: /Appearance Forest/ })).toBeInTheDocument();
    expect(within(tiles).getByRole('link', { name: /Downloads 1.*MB/ })).toBeInTheDocument();
    expect(document.querySelector('[data-settings-section-body]')).toBeNull();
  });

  it('opens a tile full width under its own title', () => {
    design({ layout: 'D' });
    open('/settings/plugins');
    expect(screen.getByRole('heading', { level: 1, name: 'Plugins' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Settings sections' })).toBeNull();
    expect(screen.getByRole('switch', { name: /Normalize volume/ })).toBeInTheDocument();
  });
});

describe('rows styles', () => {
  it.each([
    ['A', ['divide-y', 'border-b'], ['bg-card']],
    ['B', ['divide-y', 'rounded-lg', 'bg-card'], ['border-b']],
    ['C', ['flex-col', 'gap-cluster'], ['divide-y', 'bg-card']],
  ] as const)('rows %s draws its groups its own way', (rows, has, hasNot) => {
    design({ rows });
    open('/settings/help');
    const group = document.querySelector('[data-settings-group]')!;
    expect(group).toHaveAttribute('data-rows-style', rows);
    for (const c of has) expect(group).toHaveClass(c);
    for (const c of hasNot) expect(group).not.toHaveClass(c);
    expect(within(group as HTMLElement).getByRole('switch', { name: /crash reports/ })).toBeInTheDocument();
  });
});

describe('edit styles reach Account', () => {
  it.each([
    ['A', 'Username', null],
    ['B', null, 'Edit username'],
    ['C', 'Username', null],
  ] as const)('edit %s', (edit, field, button) => {
    design({ edit });
    open('/settings/profile');
    expect(document.querySelector(`[data-edit-style="${edit}"]`)).not.toBeNull();
    if (field) expect(screen.getByLabelText(field)).toBeInTheDocument();
    if (button) expect(screen.getByRole('button', { name: button })).toBeInTheDocument();
  });
});

it('picks a layout from the URL', () => {
  window.history.replaceState(null, '', '/settings?settings=D&rows=B');
  open('/settings');
  expect(document.querySelector('[data-settings-layout="D"]')).not.toBeNull();
  window.history.replaceState(null, '', '/');
});

it('keeps phones and narrow windows on the old layout, with no switcher', () => {
  setWidth(900);
  open('/settings/profile');
  expect(screen.getByText('Routed page')).toBeInTheDocument();
  expect(screen.queryByTestId('design-preview')).toBeNull();
  expect(document.querySelector('[data-settings-layout]')).toBeNull();
});
