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

const SECTIONS = ['Account', 'Devices', 'Appearance', 'Plugins', 'Downloads', 'Uploads', 'Help'];

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
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(SECTIONS);
    const active = within(nav).getByRole('link', { name: 'Account' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveClass('bg-ember/14');
    expect(active.querySelector('svg')).toHaveClass('text-ember');
    expect(within(nav).getByRole('link', { name: 'Devices' })).not.toHaveAttribute('aria-current');
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

  it("has nothing the app sidebar already has: no What's new, Admin or Library, even for admins", () => {
    state.admin = true;
    open('/settings/help');
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    for (const name of ["What's new", 'Admin', 'Library']) expect(within(nav).queryByRole('link', { name })).toBeNull();
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/settings/profile', '/settings/devices', '/settings/appearance', '/settings/plugins',
      '/settings/downloads', '/settings/uploads', '/settings/help',
    ]);
  });

  it('sends /settings/library (a phone page) to Account, where Blocked songs now are', () => {
    open('/settings/library');
    expect(state.replace).toHaveBeenCalledWith('/settings/profile');
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Blocked songs' })).toBeInTheDocument();
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

describe('a hard load draws one layout, never the phone one first (layout-shift pass)', () => {
  // The server has no window: it draws the phone layout, hidden from lg up
  // until the client knows the width, so a desktop window never shows it.
  it('the server render hides the phone layout from lg up, build stamp included', async () => {
    const { renderToString } = await import('react-dom/server');
    state.path = '/settings/appearance';
    const html = renderToString(<SettingsLayout>Routed page</SettingsLayout>);
    const box = document.createElement('div');
    box.innerHTML = html;
    const frame = box.querySelector('[data-settings-frame]');
    expect(frame).toHaveAttribute('data-settings-frame', 'pending');
    expect(frame).toHaveClass('lg:hidden');
    expect(frame).toHaveTextContent('Routed page');
    expect(box.querySelector('[data-settings-layout]')).toBeNull();
    // Nothing outside the hidden frame.
    expect(box.firstElementChild?.children).toHaveLength(1);
  });

  it('on a desktop window hydration swaps straight to the menu layout', async () => {
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');
    state.path = '/settings/appearance';
    const box = document.createElement('div');
    box.innerHTML = renderToString(<SettingsLayout>Routed page</SettingsLayout>);
    document.body.appendChild(box);
    const root = await act(async () => hydrateRoot(box, <SettingsLayout>Routed page</SettingsLayout>));
    expect(box.querySelector('[data-settings-layout="menu"]')).not.toBeNull();
    expect(box.querySelector('[data-settings-frame]')).toBeNull();
    act(() => root.unmount());
    box.remove();
  });

  it('on a phone the wrapper stays and only stops hiding, so the page is not mounted twice', async () => {
    setWidth(390);
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');
    state.path = '/settings/appearance';
    const box = document.createElement('div');
    box.innerHTML = renderToString(<SettingsLayout><p data-testid="routed">Routed page</p></SettingsLayout>);
    document.body.appendChild(box);
    const before = box.querySelector('[data-testid="routed"]');
    const root = await act(async () => hydrateRoot(box, <SettingsLayout><p data-testid="routed">Routed page</p></SettingsLayout>));
    const frame = box.querySelector('[data-settings-frame]');
    expect(frame).toHaveAttribute('data-settings-frame', 'phone');
    expect(frame).not.toHaveClass('lg:hidden');
    expect(box.querySelector('[data-testid="routed"]')).toBe(before);
    act(() => root.unmount());
    box.remove();
  });
});
