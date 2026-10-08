import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNativeCookies } from './nativeCookies';

/** The phone app writes the WebView's cookies to disk when the page signs in
 *  or out (EmberApp.flushCookies): Chromium otherwise waits ~30 s, and a
 *  process killed sooner came back signed out (2026-10-07, the car). */

type W = { Capacitor?: unknown };

afterEach(() => {
  delete (window as unknown as W).Capacitor;
});

function shell(plugin: unknown) {
  (window as unknown as W).Capacitor = { isNativePlatform: () => true, Plugins: { EmberApp: plugin } };
}

describe('flushNativeCookies', () => {
  it('asks the phone app to flush its cookie store', async () => {
    const flushCookies = vi.fn(async () => undefined);
    shell({ flushCookies });
    expect(await flushNativeCookies()).toBe(true);
    expect(flushCookies).toHaveBeenCalledTimes(1);
  });

  it('does nothing in a browser', async () => {
    expect(await flushNativeCookies()).toBe(false);
  });

  it('does nothing in an app from before the method', async () => {
    shell({ info: vi.fn() });
    expect(await flushNativeCookies()).toBe(false);
  });

  it('never throws when the plugin call fails', async () => {
    shell({ flushCookies: vi.fn(async () => { throw new Error('bridge gone'); }) });
    expect(await flushNativeCookies()).toBe(false);
  });
});
