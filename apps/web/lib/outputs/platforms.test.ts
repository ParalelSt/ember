import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The native providers: what each platform's plugin or command answers,
// turned into the picker's one shape; and older app builds, which lack the
// calls, reading as "no picker" rather than failing.

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: unknown) => tauri.invoke(cmd, args) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, fn: (e: { payload: unknown }) => void) => {
    tauri.listeners.set(name, fn);
    return () => tauri.listeners.delete(name);
  },
}));

import { cleanLabel, guessKind } from './names';
import { createDesktopOutputs, desktopSnapshot, type DesktopOutputs } from './desktop';
import { androidCastPlugin, androidOutputsPlugin, androidSnapshot, castDevicesOf, createAndroidOutputs } from './android';
import { createIosOutputs, IOS_ROUTE_ID, iosRoutePlugin, iosSnapshot } from './ios';

const setPlugins = (plugins: Record<string, unknown> | undefined) => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = plugins ? { Plugins: plugins } : undefined;
};
afterEach(() => setPlugins(undefined));

describe('names', () => {
  it('guesses a sensible icon from a device name', () => {
    expect(guessKind('AirPods Pro')).toBe('headphones');
    expect(guessKind('WH-1000XM4')).toBe('headphones');
    expect(guessKind('JBL Flip 5 Bluetooth')).toBe('bluetooth');
    expect(guessKind('LG TV (HDMI)')).toBe('hdmi');
    expect(guessKind('Scarlett 2i2 USB')).toBe('usb');
    expect(guessKind('MacBook Pro Speakers')).toBe('computer');
    expect(guessKind('Speakers (Realtek(R) Audio)')).toBe('computer');
    expect(guessKind('Living room')).toBe('speaker');
  });

  it("drops Chrome's USB id tail", () => {
    expect(cleanLabel('Scarlett 2i2 USB (1235:8210)')).toBe('Scarlett 2i2 USB');
    expect(cleanLabel('Speakers (Realtek(R) Audio)')).toBe('Speakers (Realtek(R) Audio)');
  });
});

describe('desktop', () => {
  const RAW: DesktopOutputs = {
    devices: [
      { id: 'MacBook Pro Speakers', name: 'MacBook Pro Speakers', isDefault: true },
      { id: 'AirPods Pro', name: 'AirPods Pro', isDefault: false },
    ],
    active: 'MacBook Pro Speakers',
    preferred: null,
  };

  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.listeners.clear();
  });

  it('follows the system default: that row is lit and names the device it is now', () => {
    const s = desktopSnapshot(RAW);
    expect(s.devices[0]).toEqual({ id: 'system-default', name: 'System default', kind: 'computer', detail: 'MacBook Pro Speakers' });
    expect(s.devices.slice(1).map((d) => [d.id, d.kind])).toEqual([['MacBook Pro Speakers', 'computer'], ['AirPods Pro', 'headphones']]);
    expect(s).toMatchObject({ currentId: 'system-default', currentName: 'MacBook Pro Speakers', currentKind: 'computer', systemPicker: null });
  });

  it('a remembered device lights its own row; one that is unplugged leaves the default lit (the engine plays there)', () => {
    expect(desktopSnapshot({ ...RAW, preferred: 'AirPods Pro', active: 'AirPods Pro' })).toMatchObject({ currentId: 'AirPods Pro', currentName: 'AirPods Pro' });
    const gone = desktopSnapshot({ devices: [RAW.devices[0]], active: 'MacBook Pro Speakers', preferred: 'AirPods Pro' });
    expect(gone).toMatchObject({ currentId: 'system-default', currentName: 'MacBook Pro Speakers' });
  });

  it('switches through audio_set_output (null for the system default) and follows audio:outputs', async () => {
    tauri.invoke.mockResolvedValue({ ...RAW, preferred: 'AirPods Pro', active: 'AirPods Pro' });
    const p = createDesktopOutputs();
    expect((await p.select('AirPods Pro'))?.currentId).toBe('AirPods Pro');
    expect(tauri.invoke).toHaveBeenLastCalledWith('audio_set_output', { id: 'AirPods Pro' });
    tauri.invoke.mockResolvedValue(RAW);
    await p.select('system-default');
    expect(tauri.invoke).toHaveBeenLastCalledWith('audio_set_output', { id: null });
    const seen = vi.fn();
    const stop = p.watch(seen);
    await Promise.resolve();
    await Promise.resolve();
    tauri.listeners.get('audio:outputs')?.({ payload: { ...RAW, active: 'AirPods Pro' } });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ currentName: 'AirPods Pro' }));
    stop();
    expect(tauri.listeners.has('audio:outputs')).toBe(false);
  });

  it('an older desktop build (no audio_outputs) is no picker, not an error', async () => {
    tauri.invoke.mockRejectedValue('Command audio_outputs not allowed by ACL');
    expect(await createDesktopOutputs().snapshot()).toBeNull();
  });
});

describe('android', () => {
  const RAW = {
    outputs: [
      { id: '2', name: 'This phone', kind: 'speaker' },
      { id: '9', name: 'Pixel Buds', kind: 'bluetooth' },
      { id: '12', name: 'Dock', kind: 'dock' },
    ],
    currentId: '9',
    preferredId: null,
    systemSwitcher: true,
  };

  it("maps the plugin's outputs: the speaker is the phone, unknown kinds are other", () => {
    const s = androidSnapshot(RAW);
    expect(s.devices.map((d) => d.kind)).toEqual(['phone', 'bluetooth', 'other']);
    expect(s).toMatchObject({ currentId: '9', currentName: 'Pixel Buds', currentKind: 'bluetooth', systemPicker: 'android-switcher' });
    expect(androidSnapshot({ ...RAW, systemSwitcher: false, currentId: null })).toMatchObject({ currentId: null, currentName: null, systemPicker: null });
  });

  it('an app build without output switching has no provider (and none without the cast list)', () => {
    setPlugins({ EmberPlayer: { getCastState: vi.fn(), showCastPicker: vi.fn(), addListener: vi.fn() } });
    expect(androidOutputsPlugin()).toBeNull();
    expect(androidCastPlugin()).toBeNull();
    setPlugins(undefined);
    expect(androidOutputsPlugin()).toBeNull();
  });

  it('switches, opens the system switcher, and hears changes', async () => {
    const handlers = new Map<string, (d: never) => void>();
    const plugin = {
      getOutputs: vi.fn(async () => RAW),
      setOutput: vi.fn(async ({ id }: { id: string | null }) => ({ ...RAW, currentId: id, preferredId: id })),
      showOutputSwitcher: vi.fn(async () => ({ shown: true })),
      addListener: vi.fn(async (event: string, cb: (d: never) => void) => {
        handlers.set(event, cb);
        return { remove: () => handlers.delete(event) };
      }),
    };
    setPlugins({ EmberPlayer: plugin });
    const p = createAndroidOutputs(androidOutputsPlugin()!);
    expect((await p.select('2'))?.currentId).toBe('2');
    expect(plugin.setOutput).toHaveBeenCalledWith({ id: '2' });
    await p.openSystemPicker!();
    expect(plugin.showOutputSwitcher).toHaveBeenCalled();
    const seen = vi.fn();
    const stop = p.watch(seen);
    await Promise.resolve();
    await Promise.resolve();
    (handlers.get('outputs') as (d: unknown) => void)({ ...RAW, currentId: '2' });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ currentId: '2', currentName: 'This phone' }));
    stop();
    expect(handlers.has('outputs')).toBe(false);
  });

  it('a failing bridge reads as no snapshot', async () => {
    const p = createAndroidOutputs({ getOutputs: async () => Promise.reject(new Error('x')), setOutput: vi.fn(), addListener: vi.fn() } as never);
    expect(await p.snapshot()).toBeNull();
  });

  it('cast devices: keeps well-formed ones only', () => {
    expect(castDevicesOf({ devices: [
      { id: 'tv', name: 'TV', description: 'Chromecast', selected: true, connecting: false },
      { id: 'x' },
      { id: 'sp', name: 'Speaker', description: '' },
    ] })).toEqual([
      { id: 'tv', name: 'TV', description: 'Chromecast', selected: true, connecting: false },
      { id: 'sp', name: 'Speaker', description: null, selected: false, connecting: false },
    ]);
    expect(castDevicesOf(null)).toEqual([]);
  });
});

describe('ios', () => {
  it('shows the route in use, named, with the route picker', () => {
    expect(iosSnapshot({ name: 'AirPods Pro', kind: 'bluetooth' })).toEqual({
      devices: [{ id: IOS_ROUTE_ID, name: 'AirPods Pro', kind: 'bluetooth' }],
      currentId: IOS_ROUTE_ID,
      currentName: 'AirPods Pro',
      currentKind: 'bluetooth',
      systemPicker: 'ios-route-picker',
    });
    expect(iosSnapshot({ name: 'Living Room', kind: 'other', airplay: true }).currentKind).toBe('airplay');
    expect(iosSnapshot({ name: '', kind: 'speaker' })).toMatchObject({ currentName: 'This iPhone', currentKind: 'phone' });
  });

  it('a tap on the route (or the picker row) opens the route picker; an old app has no plugin', async () => {
    setPlugins({});
    expect(iosRoutePlugin()).toBeNull();
    const plugin = {
      getRoute: vi.fn(async () => ({ name: 'iPhone Speaker', kind: 'speaker' })),
      showRoutePicker: vi.fn(async () => {}),
      addListener: vi.fn(async () => ({ remove: vi.fn() })),
    };
    setPlugins({ EmberAudioRoute: plugin });
    const p = createIosOutputs(iosRoutePlugin()!);
    await p.select(IOS_ROUTE_ID);
    await p.openSystemPicker!();
    expect(plugin.showRoutePicker).toHaveBeenCalledTimes(2);
    expect((await p.snapshot())?.currentName).toBe('iPhone Speaker');
  });
});
