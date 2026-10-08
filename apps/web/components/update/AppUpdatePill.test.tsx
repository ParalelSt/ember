import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppUpdatePill } from './AppUpdatePill';
import { AppUpdateCard } from '@/components/settings/AppUpdateCard';

/** The Android app's update, as the page shows it: the floating pill over
 *  every page and the Settings card. Driven through a fake EmberUpdate
 *  plugin, the way the app's WebView would drive it. */

type W = Window & { Capacitor?: unknown };

function fakePlugin(initial: Record<string, unknown>) {
  let push: (d: unknown) => void = () => {};
  const plugin = {
    getState: vi.fn(async () => initial),
    check: vi.fn(async () => ({})),
    install: vi.fn(async () => ({})),
    openInstallSettings: vi.fn(async () => ({ opened: true })),
    addListener: vi.fn((_e: string, cb: (d: unknown) => void) => {
      push = cb;
      return Promise.resolve({ remove: vi.fn() });
    }),
  };
  (window as W).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { EmberUpdate: plugin } };
  return { plugin, push: (d: unknown) => act(() => push(d)) };
}

afterEach(() => {
  delete (window as W).Capacitor;
});

describe('AppUpdatePill', () => {
  it('shows nothing in a browser', () => {
    const { container } = render(<AppUpdatePill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing in the iPhone app', () => {
    (window as W).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { EmberUpdate: { getState: vi.fn() } } };
    const { container } = render(<AppUpdatePill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays out of the way while up to date', async () => {
    fakePlugin({ status: 'up-to-date', current: '0.4.18' });
    render(<AppUpdatePill />);
    await act(async () => {});
    expect(screen.queryByTestId('app-update-pill')).toBeNull();
  });

  it('goes from downloading to ready, and a tap installs', async () => {
    const { plugin, push } = fakePlugin({ status: 'downloading', latest: '0.4.19', progress: 0.25 });
    render(<AppUpdatePill />);
    expect(await screen.findByText('Downloading update 0.4.19')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    push({ status: 'ready', latest: '0.4.19', waiting: 'tap' });
    expect(screen.getByText('Update 0.4.19 ready')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tap to install'));
    expect(plugin.install).toHaveBeenCalledOnce();
  });

  it('opens the install setting when installs are not allowed', async () => {
    const { plugin } = fakePlugin({ status: 'ready', latest: '0.4.19', waiting: 'permission', needsPermission: true });
    render(<AppUpdatePill />);
    fireEvent.click(await screen.findByText('Allow Ember to install updates'));
    expect(plugin.openInstallSettings).toHaveBeenCalledOnce();
    expect(plugin.install).not.toHaveBeenCalled();
  });

  it('shows Updating while installing, with no way to hide it', async () => {
    fakePlugin({ status: 'installing', latest: '0.4.19' });
    render(<AppUpdatePill />);
    expect(await screen.findByText('Updating Ember 0.4.19')).toBeInTheDocument();
    expect(screen.queryByLabelText('Hide update notice')).toBeNull();
  });

  it('can be hidden, and comes back when the state moves on', async () => {
    const { push } = fakePlugin({ status: 'downloading', latest: '0.4.19', progress: 0.5 });
    render(<AppUpdatePill />);
    fireEvent.click(await screen.findByLabelText('Hide update notice'));
    expect(screen.queryByTestId('app-update-pill')).toBeNull();
    push({ status: 'downloading', latest: '0.4.19', progress: 0.6 });
    expect(screen.queryByTestId('app-update-pill')).toBeNull();
    push({ status: 'ready', latest: '0.4.19', waiting: 'tap' });
    expect(screen.getByTestId('app-update-pill')).toHaveAttribute('data-status', 'ready');
  });
});

describe('AppUpdateCard', () => {
  it('is not in Settings outside the Android app', () => {
    const { container } = render(<AppUpdateCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the app version and checks for updates on a tap', async () => {
    const { plugin, push } = fakePlugin({ status: 'up-to-date', current: '0.4.18' });
    render(<AppUpdateCard />);
    expect(await screen.findByText(/Ember for Android 0\.4\.18/)).toBeInTheDocument();
    expect(screen.getByTestId('app-update-line')).toHaveTextContent('Ember is up to date');
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }));
    expect(plugin.check).toHaveBeenCalledOnce();
    push({ status: 'checking', current: '0.4.18' });
    expect(screen.getByRole('button', { name: /Check for updates/ })).toBeDisabled();
  });

  it('offers Install once an update is ready, and the switch when it needs one', async () => {
    const { plugin, push } = fakePlugin({ status: 'ready', current: '0.4.18', latest: '0.4.19', waiting: 'playback' });
    render(<AppUpdateCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install update' }));
    expect(plugin.install).toHaveBeenCalledOnce();
    push({ status: 'ready', current: '0.4.18', latest: '0.4.19', waiting: 'permission' });
    fireEvent.click(screen.getByRole('button', { name: 'Allow installs' }));
    expect(plugin.openInstallSettings).toHaveBeenCalledOnce();
  });

  it('in the car there is no Install, only the check', async () => {
    fakePlugin({ status: 'ready', current: '0.4.18', latest: '0.4.19', waiting: 'car' });
    render(<AppUpdateCard />);
    expect(await screen.findByTestId('app-update-line')).toHaveTextContent(/parked/);
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
  });
});
