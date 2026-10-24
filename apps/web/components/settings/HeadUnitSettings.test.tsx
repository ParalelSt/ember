import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { BOOT_START_UPDATE_APP_TEXT, HeadUnitSettings } from './HeadUnitSettings';
import { useSettingsStore } from '@/stores/useSettingsStore';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const headUnit = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useHeadUnit', () => ({ useIsHeadUnit: () => headUnit.value }));

/** Settings > Devices, Android app only: "Open Ember when this device
 *  starts" and "and keep playing", both off by default, kept by the app. */

type W = { Capacitor?: unknown };

afterEach(() => {
  headUnit.value = false;
  useSettingsStore.setState({ headUnitControls: true });
  delete (window as unknown as W).Capacitor;
  vi.mocked(toast.error).mockClear();
});

function app(platform: string, plugin: unknown) {
  (window as unknown as W).Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, Plugins: { EmberApp: plugin } };
}

function androidWith(stored = { enabled: false, keepPlaying: false }) {
  let held = { ...stored };
  const setBootStart = vi.fn(async (next: typeof held) => {
    held = { ...next };
    return held;
  });
  app('android', { getBootStart: vi.fn(async () => held), setBootStart });
  return setBootStart;
}

const startSwitch = (state: 'on' | 'off') => screen.getByRole('button', { name: `Turn ${state} Open Ember when this device starts` });
const keepSwitch = (state: 'on' | 'off') => screen.getByRole('button', { name: `Turn ${state} And keep playing` });

describe('HeadUnitSettings', () => {
  it('shows nothing in a browser or the iPhone app', () => {
    const { container } = render(<HeadUnitSettings />);
    expect(container).toBeEmptyDOMElement();
    app('ios', { getBootStart: vi.fn(), setBootStart: vi.fn() });
    const again = render(<HeadUnitSettings />);
    expect(again.container).toBeEmptyDOMElement();
  });

  it('starts off, with keep playing off and unavailable until the start is on', async () => {
    androidWith();
    render(<HeadUnitSettings />);
    await waitFor(() => expect(startSwitch('on')).toBeEnabled());
    expect(startSwitch('on')).toHaveAttribute('aria-pressed', 'false');
    expect(keepSwitch('on')).toHaveAttribute('aria-pressed', 'false');
    expect(keepSwitch('on')).toBeDisabled();
  });

  it('turning it on saves it in the app, then keep playing can be turned on', async () => {
    const save = androidWith();
    render(<HeadUnitSettings />);
    await waitFor(() => expect(startSwitch('on')).toBeEnabled());
    fireEvent.click(startSwitch('on'));
    await waitFor(() => expect(startSwitch('off')).toHaveAttribute('aria-pressed', 'true'));
    expect(save).toHaveBeenLastCalledWith({ enabled: true, keepPlaying: false });
    await waitFor(() => expect(keepSwitch('on')).toBeEnabled());
    fireEvent.click(keepSwitch('on'));
    await waitFor(() => expect(keepSwitch('off')).toHaveAttribute('aria-pressed', 'true'));
    expect(save).toHaveBeenLastCalledWith({ enabled: true, keepPlaying: true });
  });

  it('shows what the app has stored', async () => {
    androidWith({ enabled: true, keepPlaying: true });
    render(<HeadUnitSettings />);
    await waitFor(() => expect(startSwitch('off')).toHaveAttribute('aria-pressed', 'true'));
    expect(keepSwitch('off')).toHaveAttribute('aria-pressed', 'true');
  });

  it('goes back and says so when the app cannot save it', async () => {
    app('android', {
      getBootStart: vi.fn(async () => ({ enabled: false, keepPlaying: false })),
      setBootStart: vi.fn(async () => { throw new Error('no storage'); }),
    });
    render(<HeadUnitSettings />);
    await waitFor(() => expect(startSwitch('on')).toBeEnabled());
    fireEvent.click(startSwitch('on'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(startSwitch('on')).toHaveAttribute('aria-pressed', 'false');
  });

  it('an Android app from before the setting says to update it', () => {
    app('android', { info: vi.fn() });
    render(<HeadUnitSettings />);
    expect(screen.getByText(BOOT_START_UPDATE_APP_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Ember when this device starts/ })).toBeNull();
  });

  it('on a head unit, the car layout switch is there, on by default, and turns it off', async () => {
    headUnit.value = true;
    androidWith();
    render(<HeadUnitSettings />);
    const sw = screen.getByRole('button', { name: 'Turn off Car layout' });
    expect(sw).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(sw);
    expect(useSettingsStore.getState().headUnitControls).toBe(false);
    expect(screen.getByRole('button', { name: 'Turn on Car layout' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('elsewhere there is no car layout switch', async () => {
    androidWith();
    render(<HeadUnitSettings />);
    await waitFor(() => expect(startSwitch('on')).toBeEnabled());
    expect(screen.queryByRole('button', { name: /Car layout/ })).toBeNull();
  });

  it('explains how to put Ember on a head unit, with this server\'s /apk address', () => {
    androidWith();
    render(<HeadUnitSettings />);
    const help = screen.getByTestId('head-unit-help');
    expect(help).toHaveTextContent('Use Ember on a car head unit');
    expect(screen.getByTestId('head-unit-apk')).toHaveTextContent(`${window.location.origin}/apk`);
    expect(help).toHaveTextContent(/USB stick/);
    expect(help).toHaveTextContent(/hotspot/);
    expect(help).toHaveTextContent(/SIM/);
    expect(help).toHaveTextContent(/Open Ember when this device starts/);
  });

  it('the help is there in an Android app too old for the start setting', () => {
    app('android', { info: vi.fn() });
    render(<HeadUnitSettings />);
    expect(screen.getByTestId('head-unit-help')).toBeInTheDocument();
  });
});
