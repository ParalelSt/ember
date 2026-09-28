import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cast = vi.hoisted(() => ({ requestCast: vi.fn(async () => {}), stopCast: vi.fn(async () => {}) }));
vi.mock('@/lib/cast/controller', () => ({ requestCast: cast.requestCast, stopCast: cast.stopCast }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), breadcrumb: vi.fn() } }));
const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (c: string, a?: unknown) => tauri.invoke(c, a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

import {
  _resetOutputs,
  chooseCastDevice,
  chooseOutput,
  initOutputs,
  openSystemPicker,
  providerFor,
  refreshOutputs,
} from './controller';
import { useOutputStore } from '@/stores/useOutputStore';
import { useCastStore } from '@/stores/useCastStore';
import type { AudioBackend } from '@/lib/playback/types';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const noBackend = () => null;

type W = { Capacitor?: unknown; __TAURI_INTERNALS__?: unknown };
const setCapacitor = (platform: 'android' | 'ios' | null, plugins: Record<string, unknown> = {}) => {
  (window as unknown as W).Capacitor = platform
    ? { isNativePlatform: () => true, getPlatform: () => platform, Plugins: plugins }
    : undefined;
};

const ANDROID_RAW = {
  outputs: [
    { id: '2', name: 'This phone', kind: 'speaker' },
    { id: '9', name: 'Pixel Buds', kind: 'bluetooth' },
  ],
  currentId: '9',
  preferredId: null,
  systemSwitcher: true,
};
function androidPlugin() {
  return {
    getOutputs: vi.fn(async () => ANDROID_RAW),
    setOutput: vi.fn(async ({ id }: { id: string | null }) => ({ ...ANDROID_RAW, currentId: id })),
    showOutputSwitcher: vi.fn(async () => ({ shown: true })),
    getCastDevices: vi.fn(async () => ({ devices: [{ id: 'tv', name: 'TV', description: null, selected: false, connecting: false }] })),
    selectCastDevice: vi.fn(async () => {}),
    stopCasting: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  };
}

beforeEach(() => {
  _resetOutputs();
  cast.requestCast.mockClear();
  cast.stopCast.mockClear();
  toast.mockClear();
  toast.error.mockClear();
  tauri.invoke.mockReset();
  useCastStore.setState({ path: null, availability: 'none', connection: 'idle', deviceName: null });
});
afterEach(() => {
  setCapacitor(null);
  _resetOutputs();
});

describe('providerFor', () => {
  it('picks the platform from the engine that plays', () => {
    setCapacitor('android', { EmberPlayer: androidPlugin() });
    expect(providerFor({ kind: 'android', localBackend: noBackend })?.platform).toBe('android');
    setCapacitor('ios', { EmberAudioRoute: { getRoute: vi.fn(), showRoutePicker: vi.fn(), addListener: vi.fn() } });
    expect(providerFor({ kind: 'capacitor', localBackend: noBackend })?.platform).toBe('ios');
    setCapacitor(null);
    expect(providerFor({ kind: 'tauri-native', localBackend: noBackend })?.platform).toBe('desktop');
  });

  it('none for an app build from before, the old Android shell, or a stub engine', () => {
    setCapacitor('android', { EmberPlayer: { getCastState: vi.fn(), addListener: vi.fn() } });
    expect(providerFor({ kind: 'android', localBackend: noBackend })).toBeNull();
    expect(providerFor({ kind: 'capacitor', localBackend: noBackend })).toBeNull();
    setCapacitor('ios', {});
    expect(providerFor({ kind: 'capacitor', localBackend: noBackend })).toBeNull();
    setCapacitor(null);
    expect(providerFor({ kind: 'native-stub', localBackend: noBackend })).toBeNull();
  });

  it('web: only a computer browser with setSinkId', () => {
    const had = 'setSinkId' in HTMLMediaElement.prototype;
    const mm = window.matchMedia;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: async () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    try {
      window.matchMedia = ((q: string) => ({ matches: false, media: q })) as typeof window.matchMedia;
      if (had) expect(providerFor({ kind: 'web', localBackend: noBackend })?.platform).toBe('web');
      window.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), media: q })) as typeof window.matchMedia;
      expect(providerFor({ kind: 'web', localBackend: noBackend })).toBeNull();
      // The desktop app's web view after its engine failed: no picker.
      window.matchMedia = ((q: string) => ({ matches: false, media: q })) as typeof window.matchMedia;
      (window as unknown as W).__TAURI_INTERNALS__ = {};
      expect(providerFor({ kind: 'web', localBackend: noBackend })).toBeNull();
    } finally {
      delete (window as unknown as W).__TAURI_INTERNALS__;
      window.matchMedia = mm;
    }
  });
});

describe('initOutputs and the store', () => {
  it('fills the store from the platform, and lists the Android app’s cast devices', async () => {
    const plugin = androidPlugin();
    setCapacitor('android', { EmberPlayer: plugin });
    initOutputs({ kind: 'android', localBackend: noBackend });
    await flush();
    const s = useOutputStore.getState();
    expect(s).toMatchObject({ platform: 'android', currentId: '9', currentName: 'Pixel Buds', systemPicker: 'android-switcher' });
    expect(s.castDevices?.map((d) => d.id)).toEqual(['tv']);
  });

  it('empties it for a platform with no picker, and starts over when the engine changes', async () => {
    tauri.invoke.mockResolvedValue({ devices: [{ id: 'A', name: 'A', isDefault: true }], active: 'A', preferred: null });
    initOutputs({ kind: 'tauri-native', localBackend: noBackend });
    await flush();
    expect(useOutputStore.getState().platform).toBe('desktop');
    // The desktop engine failed; web audio in its web view cannot pick.
    (window as unknown as W).__TAURI_INTERNALS__ = {};
    try {
      initOutputs({ kind: 'web', localBackend: noBackend });
      await flush();
      expect(useOutputStore.getState()).toMatchObject({ platform: null, devices: [], currentId: null });
    } finally {
      delete (window as unknown as W).__TAURI_INTERNALS__;
    }
  });

  it('an older desktop build reads as no picker', async () => {
    tauri.invoke.mockRejectedValue('unknown command');
    initOutputs({ kind: 'tauri-native', localBackend: noBackend });
    await flush();
    expect(useOutputStore.getState().platform).toBeNull();
    await refreshOutputs();
    expect(useOutputStore.getState().platform).toBeNull();
  });
});

describe('actions', () => {
  it('a speaker picked while casting brings the music back first', async () => {
    const plugin = androidPlugin();
    setCapacitor('android', { EmberPlayer: plugin });
    initOutputs({ kind: 'android', localBackend: noBackend });
    await flush();
    useCastStore.setState({ path: 'android', connection: 'connected', deviceName: 'TV' });
    await chooseOutput('2');
    expect(cast.stopCast).toHaveBeenCalled();
    expect(plugin.setOutput).toHaveBeenCalledWith({ id: '2' });
    expect(useOutputStore.getState()).toMatchObject({ currentId: '2', busy: false });
  });

  it('a device that will not take the music says so; a closed prompt does not', async () => {
    const plugin = androidPlugin();
    plugin.setOutput.mockRejectedValueOnce(new Error('no such output'));
    plugin.showOutputSwitcher.mockRejectedValueOnce(new DOMException('dismissed', 'AbortError'));
    setCapacitor('android', { EmberPlayer: plugin });
    initOutputs({ kind: 'android', localBackend: noBackend });
    await flush();
    await chooseOutput('77');
    expect(toast.error).toHaveBeenCalledWith('Could not switch to that device.');
    toast.error.mockClear();
    await openSystemPicker();
    expect(toast.error).not.toHaveBeenCalled();
    expect(useOutputStore.getState().busy).toBe(false);
  });

  it('cast rows: a listed TV is selected natively; the one already playing opens its controls; old builds get the picker', async () => {
    const plugin = androidPlugin();
    setCapacitor('android', { EmberPlayer: plugin });
    initOutputs({ kind: 'android', localBackend: noBackend });
    await flush();
    await chooseCastDevice('tv');
    expect(plugin.selectCastDevice).toHaveBeenCalledWith({ id: 'tv' });
    useOutputStore.getState().set({ castDevices: [{ id: 'tv', name: 'TV', description: null, selected: true, connecting: false }] });
    useCastStore.setState({ path: 'android', connection: 'connected', deviceName: 'TV' });
    await chooseCastDevice('tv');
    expect(cast.requestCast).toHaveBeenCalledTimes(1);
    setCapacitor('android', { EmberPlayer: { getCastState: vi.fn(), showCastPicker: vi.fn(), addListener: vi.fn() } });
    await chooseCastDevice('tv');
    expect(cast.requestCast).toHaveBeenCalledTimes(2);
  });

  it('web: the picked speaker goes to the page’s own engine', async () => {
    let sink = '';
    const backend = {
      setOutputDevice: vi.fn(async (id: string) => {
        sink = id;
      }),
      outputDevice: () => sink,
    } as unknown as AudioBackend;
    const devices = [
      { deviceId: 'default', kind: 'audiooutput', label: 'Default - Speakers' },
      { deviceId: 'dac', kind: 'audiooutput', label: 'USB DAC' },
    ];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: async () => devices, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as typeof window.matchMedia;
    try {
      initOutputs({ kind: 'web', localBackend: () => backend });
      await flush();
      if (useOutputStore.getState().platform !== 'web') return; // a DOM without setSinkId
      await chooseOutput('dac');
      expect(sink).toBe('dac');
      expect(useOutputStore.getState().currentId).toBe('dac');
    } finally {
      window.matchMedia = mm;
      localStorage.clear();
    }
  });
});
