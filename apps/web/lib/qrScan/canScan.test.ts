import { afterEach, describe, expect, it, vi } from 'vitest';
import { canScan, canScanProbe, type ScanProbe } from './canScan';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPADOS_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const CAR = `${ANDROID_TABLET} EmberCar`;

const probe = (p: Partial<ScanProbe>): ScanProbe => ({ ua: '', shell: 'web', hasGetUserMedia: true, ...p });

describe('canScanProbe: where "Scan QR code" shows', () => {
  it('Android app on a phone or tablet (Google scanner, no camera API needed)', () => {
    expect(canScanProbe(probe({ ua: ANDROID_PHONE, shell: 'capacitor', platform: 'android' }))).toBe(true);
    expect(canScanProbe(probe({ ua: ANDROID_TABLET, shell: 'capacitor', platform: 'android', hasGetUserMedia: false }))).toBe(true);
  });

  it('iOS app when its web view has the camera API', () => {
    expect(canScanProbe(probe({ ua: IPHONE, shell: 'capacitor', platform: 'ios' }))).toBe(true);
    expect(canScanProbe(probe({ ua: IPHONE, shell: 'capacitor', platform: 'ios', hasGetUserMedia: false }))).toBe(false);
  });

  it('phone and tablet browsers with a camera API', () => {
    expect(canScanProbe(probe({ ua: IPHONE }))).toBe(true);
    expect(canScanProbe(probe({ ua: IPAD }))).toBe(true);
    expect(canScanProbe(probe({ ua: IPADOS_DESKTOP, maxTouchPoints: 5 }))).toBe(true);
    expect(canScanProbe(probe({ ua: ANDROID_PHONE }))).toBe(true);
    expect(canScanProbe(probe({ ua: ANDROID_TABLET }))).toBe(true);
    expect(canScanProbe(probe({ ua: WIN_EDGE, uaDataMobile: true }))).toBe(true);
  });

  it('not a phone browser without the camera API (plain http, old browser)', () => {
    expect(canScanProbe(probe({ ua: IPHONE, hasGetUserMedia: false }))).toBe(false);
    expect(canScanProbe(probe({ ua: ANDROID_PHONE, hasGetUserMedia: false }))).toBe(false);
  });

  it('never on desktop browsers, even with a webcam', () => {
    expect(canScanProbe(probe({ ua: MAC_CHROME }))).toBe(false);
    expect(canScanProbe(probe({ ua: WIN_EDGE, uaDataMobile: false }))).toBe(false);
    expect(canScanProbe(probe({ ua: IPADOS_DESKTOP, maxTouchPoints: 0 }))).toBe(false);
  });

  it('never in the desktop app', () => {
    expect(canScanProbe(probe({ ua: MAC_CHROME, shell: 'tauri' }))).toBe(false);
    expect(canScanProbe(probe({ ua: WIN_EDGE, shell: 'tauri' }))).toBe(false);
  });

  it('never on a car screen, app or not', () => {
    expect(canScanProbe(probe({ ua: CAR, shell: 'capacitor', platform: 'android' }))).toBe(false);
    expect(canScanProbe(probe({ ua: CAR }))).toBe(false);
  });
});

describe('canScan (browser globals)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('desktop test browser: no', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(MAC_CHROME);
    expect(canScan()).toBe(false);
  });

  it('Android app: yes', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ANDROID_PHONE);
    (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    expect(canScan()).toBe(true);
  });
});
