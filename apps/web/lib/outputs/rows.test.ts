import { describe, expect, it } from 'vitest';
import { controlledName, deviceSections, devicesButtonVisible, devicesLabel, freshDevices, lastSeen, playingOn, type CastSummary, type OutputSummary, type RemoteSummary } from './rows';

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

  it('names the device this one controls: after casting, before the headset', () => {
    const cast: CastSummary = { path: 'android', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' };
    expect(playingOn(ANDROID, NO_CAST, 'Windows')).toBe('Windows');
    expect(playingOn(ANDROID, cast, 'Windows')).toBe('Living Room TV');
    expect(playingOn({ ...ANDROID, platform: null }, NO_CAST, 'Windows')).toBe('Windows');
    expect(devicesLabel(NO_OUT, NO_CAST, 'Windows')).toBe('Devices: playing on Windows');
    expect(devicesButtonVisible({ ...NO_OUT, platform: null }, NO_CAST, 'Windows')).toBe(true);
    expect(devicesButtonVisible({ ...NO_OUT, platform: null }, NO_CAST)).toBe(false);
  });
});

describe('Your devices', () => {
  const snap = (isPlaying: boolean) => ({
    trackId: 'youtube:a', index: 0, queueHash: 'h', position: 10, duration: 200, isPlaying, volume: 1, muted: false,
    track: { id: 'youtube:a', source: 'youtube' as const, sourceId: 'a', title: 'A', artist: 'X', artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: null, streamUrl: '/s/a' },
    upNext: [], queueLength: 1, loopMode: 'off' as const, shuffle: false, context: null, at: 0, changedAt: 0,
  });
  const NOW = 1_000_000;
  const win = { deviceId: 'win-1', label: 'Windows', platform: 'windows' as const, shell: 'tauri' as const, browser: null, lastBeat: NOW - 1000, stale: false, snapshot: snap(true) };
  const phone = { deviceId: 'phone-1', label: 'Android phone', platform: 'android' as const, shell: 'android' as const, browser: null, lastBeat: NOW - 40_000, stale: true, snapshot: snap(false) };
  const local: RemoteSummary = { devices: [win, phone], mode: 'local', target: null, thisKind: 'computer', now: NOW };
  const controlling: RemoteSummary = { ...local, mode: 'controlling', target: 'win-1' };
  const DESKTOP_OUT: OutputSummary = {
    ...NO_OUT, platform: 'desktop',
    devices: [{ id: 'spk', name: 'Speakers', kind: 'computer' }, { id: 'usb', name: 'Scarlett', kind: 'usb' }],
    currentId: 'spk', currentName: 'Speakers', currentKind: 'computer',
  };
  const CAST: CastSummary = { path: 'google', availability: 'available', connection: 'idle', deviceName: null };

  it('sits between this computer and cast, a row per device with what it does', () => {
    const sections = deviceSections(DESKTOP_OUT, CAST, local);
    expect(sections.map((s) => s.key)).toEqual(['outputs', 'devices', 'cast']);
    const yours = sections[1];
    expect(yours.title).toBe('Your devices');
    expect(yours.rows.map((r) => [r.label, r.detail, r.icon, r.current])).toEqual([
      ['Windows', 'Playing', 'computer', false],
      ['Android phone', 'Last seen 40 s ago', 'phone', false],
    ]);
    expect(yours.rows[0].action).toEqual({ type: 'ember-device', id: 'win-1', name: 'Windows' });
  });

  it('while controlling: the device playing is lit, no local output is, and This computer leads the way back', () => {
    const sections = deviceSections(DESKTOP_OUT, CAST, controlling);
    expect(sections[0].rows.some((r) => r.current)).toBe(false);
    const yours = sections[1];
    expect(yours.rows[0]).toMatchObject({ key: 'here', label: 'This computer', action: { type: 'here' }, current: false });
    expect(yours.rows.find((r) => r.current)?.label).toBe('Windows');
    expect(deviceSections(NO_OUT, NO_CAST, { ...controlling, thisKind: 'phone' })[0].rows[0].label).toBe('This phone');
    // Not controlling: no row for this device.
    expect(deviceSections(DESKTOP_OUT, CAST, local)[1].rows.some((r) => r.key === 'here')).toBe(false);
  });

  it('says minutes for a device seen long ago, and names two browsers apart', () => {
    expect(lastSeen(NOW - 185_000, NOW)).toBe('Last seen 3 min ago');
    const chrome = { ...win, deviceId: 'b1', platform: 'browser' as const, browser: 'Chrome' as const };
    const firefox = { ...win, deviceId: 'b2', platform: 'browser' as const, browser: 'Firefox' as const };
    const labels = deviceSections(NO_OUT, NO_CAST, { ...local, devices: [chrome, firefox] })[0].rows.map((r) => r.label);
    expect(labels).toEqual(['Browser (Chrome)', 'Browser (Firefox)']);
    expect(deviceSections(NO_OUT, NO_CAST, { ...local, devices: [chrome] })[0].rows[0].label).toBe('Browser');
  });

  it('the button shows when another device could take the music, and names the one controlled', () => {
    expect(devicesButtonVisible(NO_OUT, NO_CAST, null, freshDevices(local))).toBe(true);
    expect(devicesButtonVisible(NO_OUT, NO_CAST, null, freshDevices({ ...local, devices: [phone] }))).toBe(false);
    expect(controlledName(controlling)).toBe('Windows');
    expect(controlledName(local)).toBeNull();
    expect(playingOn(DESKTOP_OUT, NO_CAST, controlledName(controlling))).toBe('Windows');
  });
});
