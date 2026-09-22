import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeSpeechEvents } from '@/test-utils/fakeSpeechEvents';
import { createTauriSpeech, tauriSpeechPresent } from './tauriSpeech';
import { SpeechStartError } from './types';

type Listener = (e: { payload: unknown }) => void;
const bridge = vi.hoisted(() => ({
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  unlistened: [] as string[],
  invoked: [] as Array<{ cmd: string; args?: Record<string, unknown> }>,
  answer: new Map<string, () => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    bridge.invoked.push({ cmd, args });
    return bridge.answer.get(cmd)?.() ?? Promise.resolve(undefined);
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, fn: Listener) => {
    bridge.listeners.set(name, fn);
    return Promise.resolve(() => {
      bridge.unlistened.push(name);
      return Promise.resolve();
    });
  },
}));

const emit = (name: string, payload: unknown = {}) => bridge.listeners.get(name)?.({ payload });
const flush = () => new Promise((r) => setTimeout(r, 0));
const cmds = () => bridge.invoked.map((c) => c.cmd);

beforeEach(() => {
  bridge.listeners.clear();
  bridge.unlistened = [];
  bridge.invoked = [];
  bridge.answer.clear();
  bridge.answer.set('speech_available', () => Promise.resolve({ available: true, onDevice: true }));
});
afterEach(() => vi.useRealTimers());

describe('tauriSpeech', () => {
  it('detects the invoke bridge', () => {
    expect(tauriSpeechPresent({ __TAURI_INTERNALS__: { invoke: () => {} } } as unknown as Window)).toBe(true);
    expect(tauriSpeechPresent({ __TAURI__: {} } as unknown as Window)).toBe(false);
  });

  it('subscribes to the four events, probes, then invokes speech_start with { lang }', async () => {
    await createTauriSpeech().start('en-GB', makeFakeSpeechEvents());
    expect([...bridge.listeners.keys()].sort()).toEqual([
      'speech:end',
      'speech:error',
      'speech:final',
      'speech:partial',
    ]);
    expect(bridge.invoked).toEqual([
      { cmd: 'speech_available', args: undefined },
      { cmd: 'speech_start', args: { lang: 'en-GB' } },
    ]);
  });

  it('forwards Rust events to SpeechEvents', async () => {
    const ev = makeFakeSpeechEvents();
    await createTauriSpeech().start('en-US', ev);
    emit('speech:partial', { text: 'daft' });
    emit('speech:final', { text: 'daft punk' });
    emit('speech:error', { kind: 'speech-setting-off', detail: null });
    emit('speech:end');
    expect(ev.onPartial).toHaveBeenCalledWith('daft');
    expect(ev.onFinal).toHaveBeenCalledWith('daft punk');
    expect(ev.onError).toHaveBeenCalledWith('speech-setting-off', undefined);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('unlistens after end and ignores later events', async () => {
    const ev = makeFakeSpeechEvents();
    await createTauriSpeech().start('en-US', ev);
    emit('speech:end');
    await flush();
    expect(bridge.unlistened.sort()).toEqual(['speech:end', 'speech:error', 'speech:final', 'speech:partial']);
    emit('speech:partial', { text: 'late' });
    expect(ev.onPartial).not.toHaveBeenCalled();
  });

  it.each([
    'Command speech_available not found',
    'speech_available not allowed by ACL',
  ])('an old desktop build (%s) maps to unavailable + no-bridge', async (msg) => {
    bridge.answer.set('speech_available', () => Promise.reject(msg));
    const ev = makeFakeSpeechEvents();
    const err = await createTauriSpeech().start('en-US', ev).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpeechStartError);
    expect(err).toMatchObject({ kind: 'unavailable', reason: 'no-bridge' });
    expect(ev.onError).toHaveBeenCalledWith('unavailable', msg);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
    expect(cmds()).not.toContain('speech_start');
    await flush();
    expect(bridge.unlistened).toHaveLength(4);
  });

  it('a { kind, detail } rejection from speech_start maps through', async () => {
    bridge.answer.set('speech_start', () => Promise.reject({ kind: 'permission-denied', detail: 'mic denied' }));
    const ev = makeFakeSpeechEvents();
    await expect(createTauriSpeech().start('en-US', ev)).rejects.toMatchObject({
      kind: 'permission-denied',
      detail: 'mic denied',
      reason: undefined,
    });
    expect(ev.onError).toHaveBeenCalledWith('permission-denied', 'mic denied');
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('an unknown kind from Rust becomes unavailable', async () => {
    bridge.answer.set('speech_start', () => Promise.reject({ kind: 'nope', detail: null }));
    await expect(createTauriSpeech().start('en-US', makeFakeSpeechEvents())).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('a bridge that never answers the probe times out as unavailable', async () => {
    vi.useFakeTimers();
    bridge.answer.set('speech_available', () => new Promise(() => {}));
    const ev = makeFakeSpeechEvents();
    const result = createTauriSpeech().start('en-US', ev).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ kind: 'unavailable', reason: 'no-bridge' });
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('speech_start may wait on permission dialogs but not forever', async () => {
    vi.useFakeTimers();
    bridge.answer.set('speech_start', () => new Promise(() => {}));
    const ev = makeFakeSpeechEvents();
    let settled = false;
    const result = createTauriSpeech()
      .start('en-US', ev)
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(60000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(await result).toMatchObject({ kind: 'unavailable', reason: undefined });
    expect(cmds()).toContain('speech_abort');
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('stop and abort invoke their commands and swallow rejections', async () => {
    bridge.answer.set('speech_stop', () => Promise.reject(new Error('x')));
    bridge.answer.set('speech_abort', () => Promise.reject(new Error('x')));
    const ev = makeFakeSpeechEvents();
    const speech = createTauriSpeech();
    await speech.start('en-US', ev);
    speech.stop();
    speech.abort();
    await flush();
    expect(cmds()).toEqual(['speech_available', 'speech_start', 'speech_stop', 'speech_abort']);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
    expect(bridge.unlistened).toHaveLength(4);
  });
});
