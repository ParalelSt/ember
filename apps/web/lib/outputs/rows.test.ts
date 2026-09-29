import { describe, expect, it } from 'vitest';
import { deviceSections, devicesButtonVisible, devicesLabel, playingOn, type CastSummary, type OutputSummary } from './rows';

const NO_CAST: CastSummary = { path: null, availability: 'none', connection: 'idle', deviceName: null };
const NO_OUT: OutputSummary = {
  platform: null,
  devices: [],
  currentId: null,
  currentName: null,
  currentKind: null,
  systemPicker: null,
  castDevices: null,
};
const ANDROID: OutputSummary = {
  platform: 'android',
  devices: [
    { id: '2', name: 'This phone', kind: 'phone' },
    { id: '9', name: 'Pixel Buds', kind: 'bluetooth' },
  ],
  currentId: '9',
  currentName: 'Pixel Buds',
  currentKind: 'bluetooth',
  systemPicker: 'android-switcher',
  castDevices: null,
};

const keys = (out: OutputSummary, cast: CastSummary) =>
  deviceSections(out, cast).map((s) => [s.key, s.rows.map((r) => `${r.key}${r.current ? '*' : ''}`)]);

describe('devicesButtonVisible', () => {
  it('hides with nothing to choose: no outputs and no way to cast', () => {
    expect(devicesButtonVisible(NO_OUT, NO_CAST)).toBe(false);
    expect(devicesButtonVisible(NO_OUT, { ...NO_CAST, path: 'google', availability: 'none' })).toBe(false);
  });

  it('shows for outputs to switch, a cast device around, a browser that cannot tell yet, or a running session', () => {
    expect(devicesButtonVisible(ANDROID, NO_CAST)).toBe(true);
    expect(devicesButtonVisible(NO_OUT, { ...NO_CAST, path: 'google', availability: 'available' })).toBe(true);
    expect(devicesButtonVisible(NO_OUT, { ...NO_CAST, path: 'google', availability: 'unknown' })).toBe(true);
    expect(devicesButtonVisible(NO_OUT, { ...NO_CAST, path: 'android', connection: 'connected' })).toBe(true);
  });

  it('shows on a platform with only its system picker (iOS before the route is known)', () => {
    expect(devicesButtonVisible({ ...NO_OUT, platform: 'ios', systemPicker: 'ios-route-picker' }, NO_CAST)).toBe(true);
    expect(devicesButtonVisible({ ...NO_OUT, platform: 'desktop' }, NO_CAST)).toBe(false);
  });
});

describe('deviceSections', () => {
  it('Android: the phone, the headset (lit), then the system switcher', () => {
    expect(keys(ANDROID, NO_CAST)).toEqual([['outputs', ['out:2', 'out:9*', 'system']]]);
    const sys = deviceSections(ANDROID, NO_CAST)[0].rows[2];
    expect(sys).toMatchObject({ label: 'More devices', action: { type: 'system-picker' } });
    expect(deviceSections(ANDROID, NO_CAST)[0].title).toBe('This phone');
  });

  it('Android with its own cast list: every TV as a row, the connected one lit, no local output lit, and Stop casting', () => {
    const out = {
      ...ANDROID,
      castDevices: [
        { id: 'tv', name: 'Living Room TV', description: 'Chromecast', selected: true, connecting: false },
        { id: 'sp', name: 'Kitchen speaker', description: null, selected: false, connecting: false },
      ],
    };
    const cast: CastSummary = { path: 'android', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' };
    expect(keys(out, cast)).toEqual([
      ['outputs', ['out:2', 'out:9', 'system']],
      ['cast', ['cast:tv*', 'cast:sp', 'cast:stop']],
    ]);
    const rows = deviceSections(out, cast)[1].rows;
    expect(rows[0]).toMatchObject({ detail: 'Chromecast', action: { type: 'cast-device', id: 'tv' } });
    expect(rows[2].action).toEqual({ type: 'cast-stop' });
  });

  it('a device still connecting says so', () => {
    const out = { ...ANDROID, castDevices: [{ id: 'tv', name: 'TV', description: 'x', selected: false, connecting: true }] };
    const cast: CastSummary = { path: 'android', availability: 'available', connection: 'connecting', deviceName: null };
    expect(deviceSections(out, cast)[1].rows[0].detail).toBe('Connecting');
  });

  it('an older Android app (no cast list): one row that opens the picker', () => {
    const cast: CastSummary = { path: 'android', availability: 'available', connection: 'idle', deviceName: null };
    expect(keys({ ...NO_OUT }, cast)).toEqual([['cast', ['cast:picker']]]);
  });

  it('Chrome: its computer outputs, then Cast; while casting the TV is lit with Stop casting', () => {
    const web: OutputSummary = {
      ...NO_OUT,
      platform: 'web',
      devices: [{ id: 'system-default', name: 'System default', kind: 'computer' }],
      currentId: 'system-default',
      systemPicker: 'web-permission',
    };
    expect(keys(web, { ...NO_CAST, path: 'google', availability: 'unknown' })).toEqual([
      ['outputs', ['out:system-default*', 'system']],
      ['cast', ['cast:picker']],
    ]);
    expect(deviceSections(web, NO_CAST)[0].title).toBe('This computer');
    expect(deviceSections(web, NO_CAST)[0].rows[1].detail).toMatch(/microphone.*Nothing is recorded/);
    expect(keys(web, { path: 'google', availability: 'available', connection: 'connected', deviceName: 'TV' })).toEqual([
      ['outputs', ['out:system-default', 'system']],
      ['cast', ['cast:current*', 'cast:stop']],
    ]);
  });

  it('Safari: AirPlay only, and no Stop row (its own picker stops it)', () => {
    const cast: CastSummary = { path: 'airplay', availability: 'available', connection: 'connected', deviceName: 'AirPlay' };
    const s = deviceSections(NO_OUT, cast);
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe('AirPlay');
    expect(s[0].rows.map((r) => r.key)).toEqual(['cast:current']);
  });

  it('iOS: the route in use, lit, and the route picker', () => {
    const ios: OutputSummary = {
      ...NO_OUT,
      platform: 'ios',
      devices: [{ id: 'current-route', name: 'AirPods Pro', kind: 'bluetooth' }],
      currentId: 'current-route',
      currentName: 'AirPods Pro',
      currentKind: 'bluetooth',
      systemPicker: 'ios-route-picker',
    };
    expect(keys(ios, NO_CAST)).toEqual([['outputs', ['out:current-route*', 'system']]]);
    expect(deviceSections(ios, NO_CAST)[0].rows[1].label).toBe('AirPlay or Bluetooth');
  });
});

describe('playingOn and the button label', () => {
  it('names the headset, not the phone or computer itself', () => {
    expect(playingOn(ANDROID, NO_CAST)).toBe('Pixel Buds');
    expect(playingOn({ ...ANDROID, currentName: 'This phone', currentKind: 'phone' }, NO_CAST)).toBeNull();
    expect(playingOn({ platform: 'desktop', currentName: 'MacBook Pro Speakers', currentKind: 'computer' }, NO_CAST)).toBeNull();
    expect(devicesLabel(ANDROID, NO_CAST)).toBe('Devices: playing on Pixel Buds');
  });

  it('casting wins, and connecting says so', () => {
    const cast: CastSummary = { path: 'android', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' };
    expect(playingOn(ANDROID, cast)).toBe('Living Room TV');
    expect(playingOn(NO_OUT, { ...cast, path: 'airplay' })).toBe('AirPlay');
    expect(devicesLabel(NO_OUT, { ...cast, connection: 'connecting' })).toBe('Devices: connecting to a cast device');
    expect(devicesLabel(NO_OUT, NO_CAST)).toBe('Devices');
  });

  it('says nothing on a page that cannot pick outputs', () => {
    expect(playingOn({ ...ANDROID, platform: null }, NO_CAST)).toBeNull();
  });
});
