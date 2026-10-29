import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootStartSupported, getBootStart, isAndroidApp, setBootStart } from './bootStart';

/** "Open Ember when this device starts" lives in the Android app
 *  (EmberApp.getBootStart / setBootStart): only there, never elsewhere. */

type W = { Capacitor?: unknown };

afterEach(() => {
  delete (window as unknown as W).Capacitor;
});

function app(platform: string, plugin: unknown) {
  (window as unknown as W).Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, Plugins: { EmberApp: plugin } };
}

describe('bootStart', () => {
  it('reads and saves the setting in the Android app', async () => {
    const setBoot = vi.fn(async (next: unknown) => next);
    app('android', { getBootStart: vi.fn(async () => ({ enabled: true, keepPlaying: false })), setBootStart: setBoot });
    expect(isAndroidApp()).toBe(true);
    expect(bootStartSupported()).toBe(true);
    expect(await getBootStart()).toEqual({ enabled: true, keepPlaying: false });
    expect(await setBootStart({ enabled: true, keepPlaying: true })).toEqual({ enabled: true, keepPlaying: true });
    expect(setBoot).toHaveBeenCalledWith({ enabled: true, keepPlaying: true });
  });

  it('is off for anything the app does not say is on', async () => {
    app('android', { getBootStart: vi.fn(async () => ({ enabled: 'yes' })), setBootStart: vi.fn() });
    expect(await getBootStart()).toEqual({ enabled: false, keepPlaying: false });
  });

  it('is not there in a browser or the iPhone app', async () => {
    expect(isAndroidApp()).toBe(false);
    expect(bootStartSupported()).toBe(false);
    expect(await getBootStart()).toBeNull();
    app('ios', { getBootStart: vi.fn(async () => ({ enabled: true })), setBootStart: vi.fn() });
    expect(isAndroidApp()).toBe(false);
    expect(await getBootStart()).toBeNull();
    await expect(setBootStart({ enabled: true, keepPlaying: false })).rejects.toThrow();
  });

  it('an Android app from before the setting is Android, without it', async () => {
    app('android', { info: vi.fn() });
    expect(isAndroidApp()).toBe(true);
    expect(bootStartSupported()).toBe(false);
    expect(await getBootStart()).toBeNull();
  });

  it('a failed read is no answer, a failed save throws', async () => {
    app('android', {
      getBootStart: vi.fn(async () => { throw new Error('bridge gone'); }),
      setBootStart: vi.fn(async () => { throw new Error('bridge gone'); }),
    });
    expect(await getBootStart()).toBeNull();
    await expect(setBootStart({ enabled: true, keepPlaying: false })).rejects.toThrow('bridge gone');
  });
});
