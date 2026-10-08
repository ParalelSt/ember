import { describe, expect, it, vi } from 'vitest';
import { nativeScanQr, readNativeAnswer } from './nativeScan';

const androidApp = (scanQr?: () => Promise<unknown>) => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { EmberApp: scanQr ? { scanQr } : {} },
  },
});

describe('readNativeAnswer', () => {
  it('maps the plugin answers', () => {
    expect(readNativeAnswer({ status: 'scanned', value: 'x' })).toEqual({ status: 'scanned', value: 'x' });
    expect(readNativeAnswer({ status: 'cancelled' })).toEqual({ status: 'cancelled' });
    expect(readNativeAnswer({ status: 'unavailable' })).toEqual({ status: 'unavailable' });
  });
  it('anything odd is unavailable, so the page scanner takes over', () => {
    expect(readNativeAnswer(null)).toEqual({ status: 'unavailable' });
    expect(readNativeAnswer({ status: 'scanned' })).toEqual({ status: 'unavailable' });
    expect(readNativeAnswer('scanned')).toEqual({ status: 'unavailable' });
  });
});

describe('nativeScanQr', () => {
  it('a browser has no native scanner', async () => {
    expect(await nativeScanQr({})).toEqual({ status: 'unavailable' });
  });

  it('the iOS app scans in the page', async () => {
    const scanQr = vi.fn();
    const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { EmberApp: { scanQr } } } };
    expect(await nativeScanQr(win)).toEqual({ status: 'unavailable' });
    expect(scanQr).not.toHaveBeenCalled();
  });

  it('the Android app: Google scanner answers', async () => {
    expect(await nativeScanQr(androidApp(async () => ({ status: 'scanned', value: 'ABCD-EFGH' })))).toEqual({
      status: 'scanned',
      value: 'ABCD-EFGH',
    });
    expect(await nativeScanQr(androidApp(async () => ({ status: 'cancelled' })))).toEqual({ status: 'cancelled' });
  });

  it('an APK from before scanQr (UNIMPLEMENTED, or no method) falls back', async () => {
    const unimplemented = Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' });
    expect(await nativeScanQr(androidApp(async () => Promise.reject(unimplemented)))).toEqual({ status: 'unavailable' });
    expect(await nativeScanQr(androidApp())).toEqual({ status: 'unavailable' });
  });

  it('two calls while the scanner is up share one scan', async () => {
    let resolve!: (v: unknown) => void;
    const scanQr = vi.fn(() => new Promise((r) => (resolve = r)));
    const win = androidApp(scanQr);
    const a = nativeScanQr(win);
    const b = nativeScanQr(win);
    resolve({ status: 'cancelled' });
    expect(await a).toEqual({ status: 'cancelled' });
    expect(await b).toEqual({ status: 'cancelled' });
    expect(scanQr).toHaveBeenCalledTimes(1);
    // And the next tap scans again.
    const c = nativeScanQr(win);
    resolve({ status: 'scanned', value: 'v' });
    expect(await c).toEqual({ status: 'scanned', value: 'v' });
    expect(scanQr).toHaveBeenCalledTimes(2);
  });
});
