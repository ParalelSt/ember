import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeSpeechEvents } from '@/test-utils/fakeSpeechEvents';
import { capacitorSpeechPresent, createCapacitorSpeech } from './capacitorSpeech';
import { SpeechStartError } from './types';

type Cb = (d: unknown) => void;
let listeners: Map<string, Cb>;
let removed: string[];
let plugin: {
  addListener: ReturnType<typeof vi.fn>;
  available: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  listeners = new Map();
  removed = [];
  plugin = {
    // Capacitor 7 returns a promise of the handle.
    addListener: vi.fn((name: string, cb: Cb) => {
      listeners.set(name, cb);
      return Promise.resolve({ remove: () => removed.push(name) });
    }),
    available: vi.fn().mockResolvedValue({ available: true, onDevice: false }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberSpeech: plugin } };
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('capacitorSpeech', () => {
  it('detects the plugin', () => {
    expect(capacitorSpeechPresent()).toBe(true);
    expect(capacitorSpeechPresent({} as Window)).toBe(false);
  });

  it('registers the four listeners before start and passes { lang }', async () => {
    await createCapacitorSpeech().start('hr-HR', makeFakeSpeechEvents());
    expect([...listeners.keys()].sort()).toEqual(['end', 'error', 'final', 'partial']);
    expect(plugin.start).toHaveBeenCalledWith({ lang: 'hr-HR' });
    expect(plugin.addListener.mock.invocationCallOrder[3]).toBeLessThan(plugin.start.mock.invocationCallOrder[0]);
  });

  it('forwards plugin events to SpeechEvents', async () => {
    const ev = makeFakeSpeechEvents();
    await createCapacitorSpeech().start('en-US', ev);
    listeners.get('partial')?.({ text: 'daft' });
    listeners.get('final')?.({ text: 'daft punk' });
    listeners.get('error')?.({ kind: 'network', detail: 'code 2' });
    listeners.get('error')?.({ kind: 'weird' });
    listeners.get('end')?.({});
    expect(ev.onPartial).toHaveBeenCalledWith('daft');
    expect(ev.onFinal).toHaveBeenCalledWith('daft punk');
    expect(ev.onError.mock.calls).toEqual([
      ['network', 'code 2'],
      ['unavailable', undefined],
    ]);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('removes the listeners after end and ignores later events', async () => {
    const ev = makeFakeSpeechEvents();
    await createCapacitorSpeech().start('en-US', ev);
    listeners.get('end')?.({});
    await flush();
    expect(removed.sort()).toEqual(['end', 'error', 'final', 'partial']);
    listeners.get('partial')?.({ text: 'late' });
    listeners.get('end')?.({});
    expect(ev.onPartial).not.toHaveBeenCalled();
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('also copes with synchronous listener handles', async () => {
    plugin.addListener.mockImplementation((name: string, cb: Cb) => {
      listeners.set(name, cb);
      return { remove: () => removed.push(name) };
    });
    await createCapacitorSpeech().start('en-US', makeFakeSpeechEvents());
    listeners.get('end')?.({});
    await flush();
    expect(removed).toHaveLength(4);
  });

  it('maps a rejection code, reports it, ends and rethrows', async () => {
    plugin.start.mockRejectedValue(Object.assign(new Error('microphone'), { code: 'permission-denied' }));
    const ev = makeFakeSpeechEvents();
    const err = await createCapacitorSpeech().start('en-US', ev).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpeechStartError);
    expect((err as SpeechStartError).kind).toBe('permission-denied');
    expect(ev.onError).toHaveBeenCalledWith('permission-denied', 'microphone');
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
    await flush();
    expect(removed).toHaveLength(4);
  });

  it('an unknown rejection code becomes unavailable', async () => {
    plugin.start.mockRejectedValue({ code: 'boom', message: 'x' });
    const ev = makeFakeSpeechEvents();
    await expect(createCapacitorSpeech().start('en-US', ev)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(ev.onError).toHaveBeenCalledWith('unavailable', 'x');
  });

  it('UNIMPLEMENTED means an app build without the method', async () => {
    plugin.start.mockRejectedValue({ code: 'UNIMPLEMENTED', message: 'not implemented' });
    await expect(createCapacitorSpeech().start('en-US', makeFakeSpeechEvents())).rejects.toMatchObject({
      kind: 'unavailable',
      reason: 'no-bridge',
    });
  });

  it('stop and abort call through and swallow rejections', async () => {
    plugin.stop.mockRejectedValue(new Error('x'));
    plugin.abort.mockRejectedValue(new Error('x'));
    const ev = makeFakeSpeechEvents();
    const speech = createCapacitorSpeech();
    await speech.start('en-US', ev);
    speech.stop();
    speech.abort();
    await flush();
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(plugin.abort).toHaveBeenCalledTimes(1);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
    expect(removed).toHaveLength(4);
  });

  it('a missing plugin rejects as no-bridge', async () => {
    const ev = makeFakeSpeechEvents();
    await expect(createCapacitorSpeech({} as Window).start('en-US', ev)).rejects.toMatchObject({
      reason: 'no-bridge',
    });
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });
});
