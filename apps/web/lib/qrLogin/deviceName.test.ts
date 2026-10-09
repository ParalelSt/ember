import { describe, expect, it } from 'vitest';
import { deviceLabel } from './device';
import { describeDevice } from './deviceName';

describe('describeDevice', () => {
  it.each([
    ['Chrome on Windows', 'Windows PC', 'computer'],
    ['Safari on macOS', 'Mac', 'computer'],
    ['Ember desktop on macOS', 'Mac', 'computer'],
    ['Firefox on Linux', 'Linux computer', 'computer'],
    ['Chrome on ChromeOS', 'Chromebook', 'computer'],
    ['Safari on iPad', 'iPad', 'tablet'],
    ['Safari on iPhone', 'iPhone', 'phone'],
    ['Ember on Android', 'Android device', 'phone'],
    ['Ember on Android Automotive', 'Car screen', 'car'],
    ['Ember on a phone', 'Phone', 'phone'],
    ['Ember desktop on a computer', 'Computer', 'computer'],
    ['Chrome', 'Chrome', 'computer'],
    ['A browser', 'A browser', 'computer'],
  ])('%s is %s', (label, name, kind) => {
    expect(describeDevice(label)).toEqual({ name, kind });
  });

  it('every label device.ts builds from a real User-Agent gets a name', () => {
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (Linux; Android 12) Chrome/120 Safari/537.36 EmberCar',
    ];
    expect(uas.map((ua) => describeDevice(deviceLabel(ua, 'web')).name)).toEqual(['Windows PC', 'Mac', 'Car screen']);
  });
});
