import { describe, expect, it } from 'vitest';
import { detectOs, digestOs, isPerfOs, osFromUserAgent } from './os';

/** OS detection for the perf channel's per-platform rollup: the Capacitor
 *  platform first, then the user agent (iPadOS posing as a Mac included),
 *  and the host's guess for batches that carry none. */

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 15; motorola edge 60 Build/V1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  ubuntu: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

describe('osFromUserAgent', () => {
  it('names each platform from its user agent', () => {
    expect(osFromUserAgent(UA.androidChrome)).toBe('android');
    expect(osFromUserAgent(UA.androidWebView)).toBe('android');
    expect(osFromUserAgent(UA.iphone)).toBe('ios');
    expect(osFromUserAgent(UA.ipadOld)).toBe('ios');
    expect(osFromUserAgent(UA.mac)).toBe('macos');
    expect(osFromUserAgent(UA.windows)).toBe('windows');
    expect(osFromUserAgent(UA.linux)).toBe('linux');
    expect(osFromUserAgent(UA.ubuntu)).toBe('linux');
  });

  it('counts an iPad asking for the desktop site (a Mac with touch) as iOS', () => {
    expect(osFromUserAgent(UA.mac, 5)).toBe('ios');
    expect(osFromUserAgent(UA.mac, 0)).toBe('macos');
    expect(osFromUserAgent(UA.mac, 1)).toBe('macos');
  });

  it('leaves ChromeOS, bots and nothing at all as other', () => {
    expect(osFromUserAgent(UA.chromeos)).toBe('other');
    expect(osFromUserAgent('curl/8.4.0')).toBe('other');
    expect(osFromUserAgent('')).toBe('other');
    expect(osFromUserAgent(undefined)).toBe('other');
  });
});

describe('detectOs', () => {
  const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

  it('trusts the Capacitor platform inside the phone app', () => {
    expect(detectOs({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' }, navigator: nav(UA.mac, 5) })).toBe('ios');
    expect(detectOs({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }, navigator: nav(UA.linux) })).toBe('android');
  });

  it('falls back to the user agent in a browser, a desktop app, or a Capacitor web build', () => {
    expect(detectOs({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, navigator: nav(UA.windows) })).toBe('windows');
    expect(detectOs({ navigator: nav(UA.mac, 5) })).toBe('ios');
    expect(detectOs({ navigator: nav(UA.mac) })).toBe('macos');
  });

  it('never throws', () => {
    expect(detectOs(null)).toBe('other');
    expect(detectOs({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } })).toBe('other');
  });

  it('reads the real window by default', () => {
    expect(isPerfOs(detectOs())).toBe(true);
  });
});

describe('digestOs (the host side, old batches included)', () => {
  it('keeps a valid os the batch carries', () => {
    expect(digestOs({ os: 'linux', shell: 'capacitor', device: { model: 'Pixel 8' } })).toBe('linux');
  });

  it('derives one for a batch without it: user agent, then the Android app, then other', () => {
    expect(digestOs({ shell: 'web', device: {} }, UA.windows)).toBe('windows');
    expect(digestOs({ shell: 'capacitor', device: {} })).toBe('android');
    expect(digestOs({ shell: 'web', device: { model: 'SM-S918B' } })).toBe('android');
    expect(digestOs({ shell: 'tauri', device: {} })).toBe('other');
    expect(digestOs({ shell: 'web', device: {}, os: 'beos' })).toBe('other');
    expect(digestOs({ shell: 'web', device: {} }, 'curl/8')).toBe('other');
  });
});
