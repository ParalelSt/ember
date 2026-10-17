import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AppUpdatePill, SWIPE_DISMISS_PX } from './AppUpdatePill';
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

  it('shows a ring around the icon while downloading, at the real progress', async () => {
    const { push } = fakePlugin({ status: 'downloading', latest: '0.4.19', progress: 0.25 });
    render(<AppUpdatePill />);
    expect(await screen.findByText('Downloading update 0.4.19')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    const ring = () => within(screen.getByTestId('app-update-ring')).getByRole('progressbar');
    expect(ring()).toHaveAttribute('aria-valuenow', '25');
    push({ status: 'downloading', latest: '0.4.19', progress: 0.6 });
    expect(ring()).toHaveAttribute('aria-valuenow', '60');
    push({ status: 'ready', latest: '0.4.19', waiting: 'tap' });
    expect(screen.queryByTestId('app-update-ring')).toBeNull();
  });

  it('is a card, and a ready update has an Install button that installs', async () => {
    const { plugin, push } = fakePlugin({ status: 'downloading', latest: '0.4.19', progress: 0.25 });
    render(<AppUpdatePill />);
    await screen.findByText('Downloading update 0.4.19');
    expect(screen.getByTestId('app-update-pill').className).toContain('rounded-2xl');
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    push({ status: 'ready', latest: '0.4.19', waiting: 'tap' });
    expect(screen.getByText('Update 0.4.19 ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(plugin.install).toHaveBeenCalledOnce();
  });

  it('has no Install button when it cannot install now (in the car)', async () => {
    fakePlugin({ status: 'ready', latest: '0.4.19', waiting: 'car' });
    render(<AppUpdatePill />);
    expect(await screen.findByText("Installs when you're parked")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('asks for the install permission in a small card with Allow and Later', async () => {
    const { plugin } = fakePlugin({ status: 'ready', latest: '0.4.19', waiting: 'permission', needsPermission: true });
    render(<AppUpdatePill />);
    const card = await screen.findByTestId('app-update-permission');
    expect(card).toHaveTextContent('Allow Ember to install updates');
    expect(card).toHaveTextContent(/Android asks once/);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(plugin.openInstallSettings).toHaveBeenCalledOnce();
    expect(plugin.install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByTestId('app-update-pill')).toBeNull();
    expect(plugin.openInstallSettings).toHaveBeenCalledOnce();
  });

  it('the permission card can also be closed with the X', async () => {
    fakePlugin({ status: 'ready', latest: '0.4.19', waiting: 'permission' });
    render(<AppUpdatePill />);
    fireEvent.click(await screen.findByLabelText('Hide update notice'));
    expect(screen.queryByTestId('app-update-pill')).toBeNull();
  });

  describe('swipe to dismiss', () => {
    const swipe = (el: HTMLElement, dx: number, dy = 0) => {
      fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 50 }] });
      fireEvent.touchMove(el, { touches: [{ clientX: 100 + dx, clientY: 50 + dy }] });
      fireEvent.touchEnd(el);
    };

    it('a sideways swipe past the threshold puts it away like the X', async () => {
      fakePlugin({ status: 'downloading', latest: '0.4.19', progress: 0.5 });
      render(<AppUpdatePill />);
      swipe(await screen.findByTestId('app-update-pill'), SWIPE_DISMISS_PX + 10);
      expect(screen.queryByTestId('app-update-pill')).toBeNull();
    });

    it('works to the left too', async () => {
      fakePlugin({ status: 'ready', latest: '0.4.19', waiting: 'tap' });
      render(<AppUpdatePill />);
      swipe(await screen.findByTestId('app-update-pill'), -(SWIPE_DISMISS_PX + 10));
      expect(screen.queryByTestId('app-update-pill')).toBeNull();
    });

    it('a short swipe springs back and a vertical drag does nothing', async () => {
      fakePlugin({ status: 'downloading', latest: '0.4.19', progress: 0.5 });
      render(<AppUpdatePill />);
      const el = await screen.findByTestId('app-update-pill');
      swipe(el, SWIPE_DISMISS_PX - 30);
      expect(screen.getByTestId('app-update-pill')).toBeInTheDocument();
      swipe(el, 10, 200);
      expect(screen.getByTestId('app-update-pill')).toBeInTheDocument();
    });

    it('cannot swipe away the installing notice', async () => {
      fakePlugin({ status: 'installing', latest: '0.4.19' });
      render(<AppUpdatePill />);
      swipe(await screen.findByTestId('app-update-pill'), 300);
      expect(screen.getByTestId('app-update-pill')).toBeInTheDocument();
    });
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
