import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_UPDATE_STATE,
  appUpdateAvailable,
  checkForAppUpdate,
  installAppUpdate,
  openInstallSettings,
  readUpdateState,
  subscribeAppUpdate,
  updateLine,
  updatePill,
  type AppUpdateState,
} from './appUpdate';

type W = Window & { Capacitor?: unknown };

function fakeApp(platform: 'android' | 'ios', plugin?: Record<string, unknown>) {
  (window as W).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
    Plugins: plugin ? { EmberUpdate: plugin } : {},
  };
}

afterEach(() => {
  delete (window as W).Capacitor;
});

const s = (over: Partial<AppUpdateState>): AppUpdateState => ({ ...IDLE_UPDATE_STATE, ...over });

describe('readUpdateState', () => {
  it('keeps what the plugin sent', () => {
    const st = readUpdateState({
      status: 'ready', current: '0.4.18', latest: '0.4.19', waiting: 'tap', progress: 1, checkedAt: 5, needsPermission: false, silent: true,
    });
    expect(st).toEqual({
      status: 'ready', current: '0.4.18', latest: '0.4.19', progress: 1, waiting: 'tap', error: null, checkedAt: 5, needsPermission: false, silent: true,
    });
  });

  it('turns anything odd into a safe idle state', () => {
    expect(readUpdateState(null)).toEqual(IDLE_UPDATE_STATE);
    expect(readUpdateState('x')).toEqual(IDLE_UPDATE_STATE);
    const st = readUpdateState({ status: 'exploded', waiting: 'nope', progress: 7, checkedAt: 'soon', needsPermission: 'yes' });
    expect(st.status).toBe('idle');
    expect(st.waiting).toBeNull();
    expect(st.progress).toBe(1);
    expect(st.checkedAt).toBe(0);
    expect(st.needsPermission).toBe(false);
  });
});

describe('updatePill', () => {
  it('says nothing for a check, up to date, idle or a failed check', () => {
    for (const status of ['idle', 'checking', 'up-to-date', 'failed'] as const) expect(updatePill(s({ status }))).toBeNull();
  });

  it('shows the download with its progress', () => {
    expect(updatePill(s({ status: 'downloading', latest: '0.4.19', progress: 0.42 }))).toEqual({
      title: 'Downloading update 0.4.19', detail: '42%', action: null, dismissable: true,
    });
  });

  it('offers Install when the update waits for a tap', () => {
    const pill = updatePill(s({ status: 'ready', latest: '0.4.19', waiting: 'tap' }))!;
    expect(pill.title).toBe('Update 0.4.19 ready');
    expect(pill.detail).toBe('Tap to install');
    expect(pill.action).toBe('install');
  });

  it('says it installs when the music stops, and still allows a tap', () => {
    for (const waiting of ['playback', 'idle'] as const) {
      const pill = updatePill(s({ status: 'ready', waiting }))!;
      expect(pill.detail).toMatch(/music stops/);
      expect(pill.action).toBe('install');
    }
  });

  it('offers the Settings switch when installs are not allowed', () => {
    const pill = updatePill(s({ status: 'ready', waiting: 'permission' }))!;
    expect(pill.detail).toBe('Allow Ember to install updates');
    expect(pill.action).toBe('settings');
  });

  it('in the car only says it waits, with nothing to tap', () => {
    const pill = updatePill(s({ status: 'ready', waiting: 'car' }))!;
    expect(pill.detail).toMatch(/parked/);
    expect(pill.action).toBeNull();
  });

  it('cannot be put away while installing', () => {
    expect(updatePill(s({ status: 'installing' }))!.dismissable).toBe(false);
  });
});

describe('updateLine', () => {
  it('has a line for every state', () => {
    expect(updateLine(s({ status: 'up-to-date' }))).toBe('Ember is up to date');
    expect(updateLine(s({ status: 'checking' }))).toMatch(/Checking/);
    expect(updateLine(s({ status: 'downloading', latest: '0.4.19', progress: 0.5 }))).toBe('Downloading update 0.4.19 (50%)');
    expect(updateLine(s({ status: 'ready', latest: '0.4.19', waiting: 'tap' }))).toBe('Update 0.4.19 ready. Tap to install');
    expect(updateLine(s({ status: 'failed', error: "You're offline" }))).toBe("You're offline");
    expect(updateLine(s({ status: 'failed' }))).toBe("Couldn't check for updates");
    expect(updateLine(s({ status: 'idle' }))).toMatch(/by itself/);
  });
});

describe('the plugin bridge', () => {
  it('is there only in the Android app with the updater', () => {
    expect(appUpdateAvailable()).toBe(false);
    fakeApp('ios', { getState: vi.fn() });
    expect(appUpdateAvailable()).toBe(false);
    fakeApp('android');
    expect(appUpdateAvailable()).toBe(false);
    fakeApp('android', { getState: vi.fn() });
    expect(appUpdateAvailable()).toBe(true);
  });

  it('does nothing and never throws without it', async () => {
    expect(await checkForAppUpdate()).toBe(false);
    expect(await installAppUpdate()).toBe(false);
    const cb = vi.fn();
    subscribeAppUpdate(cb)();
    expect(cb).not.toHaveBeenCalled();
  });

  it('follows the state: the current one, then each change, until unsubscribed', async () => {
    let push: (d: unknown) => void = () => {};
    const remove = vi.fn();
    fakeApp('android', {
      getState: vi.fn(async () => ({ status: 'up-to-date', current: '0.4.18' })),
      addListener: vi.fn((_e: string, cb: (d: unknown) => void) => {
        push = cb;
        return Promise.resolve({ remove });
      }),
    });
    const seen: AppUpdateState[] = [];
    const stop = subscribeAppUpdate((st) => seen.push(st));
    await Promise.resolve();
    await Promise.resolve();
    push({ status: 'downloading', progress: 0.1 });
    expect(seen.map((x) => x.status)).toEqual(['up-to-date', 'downloading']);
    stop();
    push({ status: 'ready' });
    expect(seen).toHaveLength(2);
    expect(remove).toHaveBeenCalled();
  });

  it('passes taps on, and a refused call is false', async () => {
    const plugin = {
      getState: vi.fn(async () => ({})),
      check: vi.fn(async () => ({})),
      install: vi.fn(async () => ({})),
      openInstallSettings: vi.fn(async () => {
        throw new Error('no activity');
      }),
    };
    fakeApp('android', plugin);
    expect(await checkForAppUpdate()).toBe(true);
    expect(await installAppUpdate()).toBe(true);
    expect(await openInstallSettings()).toBe(false);
    expect(plugin.check).toHaveBeenCalledOnce();
    expect(plugin.install).toHaveBeenCalledOnce();
  });
});
