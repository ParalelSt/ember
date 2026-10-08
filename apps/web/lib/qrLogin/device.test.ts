import { describe, expect, it } from 'vitest';
import { deviceLabel, shellOf } from './device';

const UA = {
  car: 'Mozilla/5.0 (Linux; Android 12; Automotive Build/SQ3A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Safari/537.36',
  carTagged: 'Mozilla/5.0 (Linux; Android 13; sdk_car_x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EmberCar',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macTauri: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 15886.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linuxOdd: 'SomeBrowser (X11; Linux x86_64)',
};

describe('deviceLabel', () => {
  it.each([
    ['the car app', UA.car, 'capacitor', 'Ember on Android Automotive'],
    ['the car app, tagged by the shell', UA.carTagged, 'capacitor', 'Ember on Android Automotive'],
    ['the Android app', UA.androidPhone, 'capacitor', 'Ember on Android'],
    ['the iPhone app', UA.iphone, 'capacitor', 'Ember on iPhone'],
    ['the desktop app on a Mac', UA.macTauri, 'tauri', 'Ember desktop on macOS'],
    ['the desktop app on Windows', UA.winChrome, 'tauri', 'Ember desktop on Windows'],
    ['Chrome on Windows', UA.winChrome, 'web', 'Chrome on Windows'],
    ['Edge on Windows', UA.winEdge, 'web', 'Edge on Windows'],
    ['Safari on a Mac', UA.macSafari, 'web', 'Safari on macOS'],
    ['Safari on an iPad', UA.ipad, 'web', 'Safari on iPad'],
    ['Chrome on Android', UA.androidPhone, 'web', 'Chrome on Android'],
    ['Firefox on Linux', UA.linuxFirefox, 'web', 'Firefox on Linux'],
    ['Chrome on a Chromebook', UA.chromebook, 'web', 'Chrome on ChromeOS'],
    ['an unknown browser on Linux', UA.linuxOdd, 'web', 'A browser on Linux'],
    ['nothing at all', '', 'web', 'A browser'],
    ['no shell hint', UA.winChrome, undefined, 'Chrome on Windows'],
  ])('%s', (_label, ua, shell, want) => {
    expect(deviceLabel(ua, shell)).toBe(want);
  });

  it('never echoes user-controlled text', () => {
    const evil = 'Mozilla/5.0 (<script>alert(1)</script>; Windows) Firefox/1 approve me now';
    const label = deviceLabel(evil, '<b>tauri</b>');
    expect(label).toBe('Firefox on Windows');
    expect(deviceLabel(`${'x'.repeat(5000)} Android`, 'capacitor')).toBe('Ember on Android');
  });

  it('is at most 80 characters', () => {
    for (const ua of Object.values(UA)) for (const s of ['web', 'capacitor', 'tauri']) expect(deviceLabel(ua, s).length).toBeLessThanOrEqual(80);
  });
});

describe('shellOf', () => {
  it('allowlists the shell hint', () => {
    expect(shellOf('capacitor')).toBe('capacitor');
    expect(shellOf('tauri')).toBe('tauri');
    expect(shellOf('web')).toBe('web');
    for (const v of ['Capacitor', 'electron', '', null, undefined, 3, { shell: 'tauri' }]) expect(shellOf(v)).toBe('web');
  });
});
