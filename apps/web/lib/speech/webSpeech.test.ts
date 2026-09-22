import { describe, expect, it, vi } from 'vitest';
import { makeFakeSpeechEvents } from '@/test-utils/fakeSpeechEvents';
import { createWebSpeech, mapWebSpeechError, webSpeechAvailable } from './webSpeech';
import { SpeechStartError } from './types';

interface FakeRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

function fakeWindow(opts: { throwOnStart?: boolean } = {}) {
  const instances: FakeRec[] = [];
  class Ctor {
    lang = '';
    interimResults = false;
    continuous = true;
    onresult = null;
    onend = null;
    onerror = null;
    start = vi.fn(() => {
      if (opts.throwOnStart) throw new Error('InvalidStateError');
    });
    stop = vi.fn();
    abort = vi.fn();
    constructor() {
      instances.push(this as unknown as FakeRec);
    }
  }
  const win = { webkitSpeechRecognition: Ctor } as unknown as Window;
  return { win, instances };
}


function results(parts: Array<[string, boolean]>) {
  const r: Record<number, unknown> & { length: number } = { length: parts.length };
  parts.forEach(([t, f], i) => {
    r[i] = { isFinal: f, 0: { transcript: t } };
  });
  return { resultIndex: 0, results: r };
}

describe('webSpeech', () => {
  it('is available only with a SpeechRecognition ctor', () => {
    expect(webSpeechAvailable(fakeWindow().win)).toBe(true);
    expect(webSpeechAvailable({} as Window)).toBe(false);
    expect(webSpeechAvailable(undefined)).toBe(false);
  });

  it('configures lang, interim results and single-utterance mode', async () => {
    const { win, instances } = fakeWindow();
    await createWebSpeech(win).start('hr-HR', makeFakeSpeechEvents());
    const rec = instances[0];
    expect(rec.lang).toBe('hr-HR');
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(false);
    expect(rec.start).toHaveBeenCalledTimes(1);
  });

  it('accumulates results and flags the final one', async () => {
    const { win, instances } = fakeWindow();
    const ev = makeFakeSpeechEvents();
    await createWebSpeech(win).start('en-US', ev);
    const rec = instances[0];
    rec.onresult?.(results([['daft ', false]]));
    rec.onresult?.(results([['daft ', true], ['punk', false]]));
    rec.onresult?.(results([['daft ', true], ['punk', true]]));
    expect(ev.onPartial.mock.calls).toEqual([['daft '], ['daft punk']]);
    expect(ev.onFinal).toHaveBeenCalledExactlyOnceWith('daft punk');
  });

  it.each([
    ['not-allowed', 'permission-denied', undefined],
    ['service-not-allowed', 'permission-denied', undefined],
    ['network', 'network', undefined],
    ['no-speech', 'no-speech', undefined],
    ['aborted', 'aborted', undefined],
    ['audio-capture', 'unavailable', 'audio-capture'],
    ['language-not-supported', 'unavailable', 'language-not-supported'],
    ['bad-grammar', 'unavailable', 'bad-grammar'],
  ])('maps %s to %s', async (code, kind, detail) => {
    expect(mapWebSpeechError(code)).toEqual(detail ? { kind, detail } : { kind });
    const { win, instances } = fakeWindow();
    const ev = makeFakeSpeechEvents();
    await createWebSpeech(win).start('en-US', ev);
    instances[0].onerror?.({ error: code });
    expect(ev.onError).toHaveBeenCalledExactlyOnceWith(kind, detail);
  });

  it('forwards onend once', async () => {
    const { win, instances } = fakeWindow();
    const ev = makeFakeSpeechEvents();
    await createWebSpeech(win).start('en-US', ev);
    instances[0].onend?.();
    instances[0].onend?.();
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('stop and abort call through', async () => {
    const { win, instances } = fakeWindow();
    const speech = createWebSpeech(win);
    await speech.start('en-US', makeFakeSpeechEvents());
    speech.stop();
    speech.abort();
    expect(instances[0].stop).toHaveBeenCalledTimes(1);
    expect(instances[0].abort).toHaveBeenCalledTimes(1);
  });

  it('a throwing start() reports unavailable, ends and rejects', async () => {
    const { win } = fakeWindow({ throwOnStart: true });
    const ev = makeFakeSpeechEvents();
    await expect(createWebSpeech(win).start('en-US', ev)).rejects.toBeInstanceOf(SpeechStartError);
    expect(ev.onError).toHaveBeenCalledWith('unavailable', 'InvalidStateError');
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });
});
