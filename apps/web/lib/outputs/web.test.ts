import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWebOutputs,
  loadRemembered,
  reconcileSink,
  saveRemembered,
  WEB_OUTPUT_KEY,
  webSnapshot,
  type MediaDeviceLike,
} from './web';
import type { AudioBackend } from '@/lib/playback/types';

const out = (deviceId: string, label: string): MediaDeviceLike => ({ deviceId, label, kind: 'audiooutput' });
const mic = (deviceId: string, label: string): MediaDeviceLike => ({ deviceId, label, kind: 'audioinput' });

/** What Chrome lists with the page allowed to name devices. */
const NAMED = [
  out('default', 'Default - MacBook Pro Speakers (Built-in)'),
  out('communications', 'Communications - MacBook Pro Speakers'),
  out('abc', 'MacBook Pro Speakers (Built-in)'),
  out('dac', 'Scarlett 2i2 USB (1235:8210)'),
  mic('m1', 'MacBook Pro Microphone'),
];
/** ...and without: one nameless default. */
const BLIND = [out('', ''), mic('', '')];

describe('webSnapshot', () => {
  it('leads with the system default, named after the device it is now, then every named speaker', () => {
    const s = webSnapshot(NAMED, '', false);
    expect(s.devices).toEqual([
      { id: 'system-default', name: 'System default', kind: 'computer', detail: 'MacBook Pro Speakers (Built-in)' },
      { id: 'abc', name: 'MacBook Pro Speakers (Built-in)', kind: 'computer' },
      { id: 'dac', name: 'Scarlett 2i2 USB', kind: 'usb' },
    ]);
    expect(s).toMatchObject({ currentId: 'system-default', currentName: 'MacBook Pro Speakers (Built-in)', currentKind: 'computer', systemPicker: null });
  });

  it('lights the device the sink is on', () => {
    expect(webSnapshot(NAMED, 'dac', false)).toMatchObject({ currentId: 'dac', currentName: 'Scarlett 2i2 USB', currentKind: 'usb' });
  });

  it('offers the way to ask when the browser names nothing (Chrome without the microphone)', () => {
    const s = webSnapshot(BLIND, '', false);
    expect(s.devices.map((d) => d.id)).toEqual(['system-default']);
    expect(s.systemPicker).toBe('web-permission');
    expect(s.currentName).toBe('This computer');
  });

  it("uses the browser's own prompt where it has one (Firefox)", () => {
    expect(webSnapshot(BLIND, '', true).systemPicker).toBe('web-select');
    expect(webSnapshot(NAMED, '', true).systemPicker).toBe('web-select');
  });
});

describe('reconcileSink', () => {
  it('drops a device that is gone for the system default, and says so', () => {
    expect(reconcileSink(NAMED.filter((d) => d.deviceId !== 'dac'), 'dac', { id: 'dac', label: 'Scarlett 2i2 USB' }))
      .toEqual({ apply: '', lost: true });
  });

  it('puts the remembered device back when it returns', () => {
    expect(reconcileSink(NAMED, '', { id: 'dac', label: 'Scarlett 2i2 USB' })).toEqual({ apply: 'dac', lost: false });
  });

  it('finds it by name when the browser re-keyed its devices (site data cleared)', () => {
    const rekeyed = [out('default', 'Default - x'), out('new-id', 'Scarlett 2i2 USB (1235:8210)')];
    expect(reconcileSink(rekeyed, '', { id: 'old-id', label: 'Scarlett 2i2 USB' })).toEqual({ apply: 'new-id', lost: false });
  });

  it('leaves things be when all is where it should be, or the list is nameless', () => {
    expect(reconcileSink(NAMED, 'dac', { id: 'dac', label: 'Scarlett 2i2 USB' })).toEqual({ apply: null, lost: false });
    expect(reconcileSink(NAMED, '', null)).toEqual({ apply: null, lost: false });
    // A nameless list is no proof the device is gone.
    expect(reconcileSink(BLIND, 'dac', null)).toEqual({ apply: null, lost: false });
  });
});

describe('remembered choice', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and clears', () => {
    saveRemembered(localStorage, { id: 'dac', label: 'Scarlett' });
    expect(loadRemembered(localStorage)).toEqual({ id: 'dac', label: 'Scarlett' });
    saveRemembered(localStorage, null);
    expect(loadRemembered(localStorage)).toBeNull();
  });

  it('reads junk, and no storage at all, as nothing', () => {
    localStorage.setItem(WEB_OUTPUT_KEY, '{not json');
    expect(loadRemembered(localStorage)).toBeNull();
    localStorage.setItem(WEB_OUTPUT_KEY, JSON.stringify({ id: 5 }));
    expect(loadRemembered(localStorage)).toBeNull();
    expect(loadRemembered(null)).toBeNull();
    expect(() => saveRemembered(null, { id: 'a', label: 'b' })).not.toThrow();
  });
});

describe('createWebOutputs', () => {
  let sink = '';
  let list: MediaDeviceLike[] = NAMED;
  const listeners = new Set<() => void>();
  const setOutputDevice = vi.fn(async (id: string) => {
    sink = id;
  });
  const backend = { setOutputDevice, outputDevice: () => sink } as unknown as AudioBackend;
  const md = () =>
    ({
      enumerateDevices: vi.fn(async () => list),
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }) as unknown as MediaDevices;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    sink = '';
    list = NAMED;
    listeners.clear();
    setOutputDevice.mockClear();
    localStorage.clear();
  });

  it('switches, remembers, and goes back to the system default', async () => {
    const p = createWebOutputs({ mediaDevices: md(), storage: localStorage, backend: () => backend });
    await flush();
    const s = await p.select('dac');
    expect(setOutputDevice).toHaveBeenLastCalledWith('dac');
    expect(s?.currentId).toBe('dac');
    expect(loadRemembered(localStorage)).toEqual({ id: 'dac', label: 'Scarlett 2i2 USB' });
    const back = await p.select('system-default');
    expect(setOutputDevice).toHaveBeenLastCalledWith('');
    expect(back?.currentId).toBe('system-default');
    expect(loadRemembered(localStorage)).toBeNull();
  });

  it('puts the music back on the remembered speaker when the page loads', async () => {
    saveRemembered(localStorage, { id: 'dac', label: 'Scarlett 2i2 USB' });
    createWebOutputs({ mediaDevices: md(), storage: localStorage, backend: () => backend });
    await flush();
    expect(sink).toBe('dac');
  });

  it('falls back when the speaker is unplugged, tells the listener, and returns when it is back', async () => {
    const onLost = vi.fn();
    const p = createWebOutputs({ mediaDevices: md(), storage: localStorage, backend: () => backend, onLost });
    await flush();
    await p.select('dac');
    const seen = vi.fn();
    const stop = p.watch(seen);
    list = NAMED.filter((d) => d.deviceId !== 'dac');
    listeners.forEach((fn) => fn());
    await flush();
    await flush();
    expect(sink).toBe('');
    expect(onLost).toHaveBeenCalledWith('Scarlett 2i2 USB');
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ currentId: 'system-default' }));
    list = NAMED;
    listeners.forEach((fn) => fn());
    await flush();
    await flush();
    expect(sink).toBe('dac');
    stop();
    expect(listeners.size).toBe(0);
  });

  it('asks for the microphone to name speakers in Chrome, closing the stream at once', async () => {
    list = BLIND;
    const devices = md();
    const stopTrack = vi.fn();
    devices.getUserMedia = vi.fn(async () => {
      list = NAMED;
      return { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    });
    const p = createWebOutputs({ mediaDevices: devices, storage: localStorage, backend: () => backend });
    expect((await p.snapshot())?.systemPicker).toBe('web-permission');
    const s = await p.openSystemPicker!();
    expect(devices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalled();
    expect(s?.devices.map((d) => d.id)).toEqual(['system-default', 'abc', 'dac']);
    expect(s?.systemPicker).toBeNull();
  });

  it("uses the browser's own prompt where it has one", async () => {
    const devices = md() as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceLike> };
    devices.selectAudioOutput = vi.fn(async () => out('dac', 'Scarlett 2i2 USB (1235:8210)'));
    const p = createWebOutputs({ mediaDevices: devices, storage: localStorage, backend: () => backend });
    const s = await p.openSystemPicker!();
    expect(sink).toBe('dac');
    expect(loadRemembered(localStorage)).toEqual({ id: 'dac', label: 'Scarlett 2i2 USB' });
    expect(s?.systemPicker).toBe('web-select');
  });

  it('refuses to switch with no web engine to move', async () => {
    const p = createWebOutputs({ mediaDevices: md(), storage: localStorage, backend: () => null });
    await expect(p.select('dac')).rejects.toThrow();
    expect(loadRemembered(localStorage)).toBeNull();
  });
});
