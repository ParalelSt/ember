import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeSpeechEvents } from '@/test-utils/fakeSpeechEvents';
import { createSpeechSession } from './session';
import type { NativeSpeech, SpeechAdapter, SpeechEvents } from './types';

function fakeAdapter(startImpl?: (events: SpeechEvents) => Promise<void>) {
  const state: { events: SpeechEvents | null; native: Record<keyof NativeSpeech, ReturnType<typeof vi.fn>> | null } = {
    events: null,
    native: null,
  };
  const adapter: SpeechAdapter = {
    kind: 'web',
    create() {
      const native = {
        start: vi.fn((_lang: string, events: SpeechEvents) => {
          state.events = events;
          return startImpl ? startImpl(events) : Promise.resolve();
        }),
        stop: vi.fn(),
        abort: vi.fn(),
      };
      state.native = native;
      return native;
    },
  };
  return { adapter, state };
}


beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSpeechSession', () => {
  it('passes lang to the adapter', async () => {
    const { adapter, state } = fakeAdapter();
    await createSpeechSession(adapter, { lang: 'de-DE', events: makeFakeSpeechEvents() }).start();
    expect(state.native?.start).toHaveBeenCalledWith('de-DE', expect.any(Object));
  });

  it('stops at 15 s and aborts at 18 s when no end arrives', async () => {
    const { adapter, state } = fakeAdapter();
    const ev = makeFakeSpeechEvents();
    await createSpeechSession(adapter, { lang: 'en-US', events: ev }).start();
    vi.advanceTimersByTime(14999);
    expect(state.native?.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.native?.stop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2999);
    expect(state.native?.abort).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.native?.abort).toHaveBeenCalledTimes(1);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('gives the first-time permission prompts all the time they take: the 15 s cap starts once listening does', async () => {
    let granted!: () => void;
    const { adapter, state } = fakeAdapter(() => new Promise<void>((r) => (granted = r)));
    const ev = makeFakeSpeechEvents();
    const started = createSpeechSession(adapter, { lang: 'en-US', events: ev }).start();
    // The person reads two OS dialogs for 40 s.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(state.native?.stop).not.toHaveBeenCalled();
    expect(state.native?.abort).not.toHaveBeenCalled();
    expect(ev.onEnd).not.toHaveBeenCalled();

    granted();
    await started;
    await vi.advanceTimersByTimeAsync(14_999);
    expect(state.native?.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.native?.stop).toHaveBeenCalledTimes(1);
  });

  it('still gives up on a start that never answers, after 90 s', async () => {
    const { adapter, state } = fakeAdapter(() => new Promise<void>(() => {}));
    const ev = makeFakeSpeechEvents();
    void createSpeechSession(adapter, { lang: 'en-US', events: ev }).start();
    await vi.advanceTimersByTimeAsync(89_999);
    expect(ev.onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.native?.abort).toHaveBeenCalledTimes(1);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('starts no cap for a listen that ended while its start was still pending', async () => {
    let granted!: () => void;
    const { adapter, state } = fakeAdapter(() => new Promise<void>((r) => (granted = r)));
    const ev = makeFakeSpeechEvents();
    const session = createSpeechSession(adapter, { lang: 'en-US', events: ev });
    const started = session.start();
    session.abort();
    granted();
    await started;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.native?.stop).not.toHaveBeenCalled();
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not abort when end arrives inside the grace period', async () => {
    const { adapter, state } = fakeAdapter();
    const ev = makeFakeSpeechEvents();
    await createSpeechSession(adapter, { lang: 'en-US', events: ev }).start();
    vi.advanceTimersByTime(15000);
    state.events?.onFinal('hello');
    state.events?.onEnd();
    vi.advanceTimersByTime(5000);
    expect(state.native?.abort).not.toHaveBeenCalled();
    expect(ev.onFinal).toHaveBeenCalledWith('hello');
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('uses injected timers', async () => {
    const { adapter, state } = fakeAdapter();
    const timers: Array<() => void> = [];
    const setT = vi.fn<(fn: () => void, ms: number) => number>((fn) => timers.push(fn));
    await createSpeechSession(adapter, {
      lang: 'en-US',
      events: makeFakeSpeechEvents(),
      hardTimeoutMs: 100,
      setTimeout: setT,
      clearTimeout: vi.fn(),
    }).start();
    expect(setT).toHaveBeenCalledWith(expect.any(Function), 100);
    timers[setT.mock.calls.findIndex((c) => c[1] === 100)]();
    expect(state.native?.stop).toHaveBeenCalledTimes(1);
  });

  it('forwards end once and ignores everything after it', async () => {
    const { adapter, state } = fakeAdapter();
    const ev = makeFakeSpeechEvents();
    await createSpeechSession(adapter, { lang: 'en-US', events: ev }).start();
    state.events?.onPartial('a');
    state.events?.onEnd();
    state.events?.onEnd();
    state.events?.onPartial('b');
    state.events?.onFinal('b');
    state.events?.onError('network');
    expect(ev.onPartial.mock.calls).toEqual([['a']]);
    expect(ev.onFinal).not.toHaveBeenCalled();
    expect(ev.onError).not.toHaveBeenCalled();
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
  });

  it('swallows the aborted kind', async () => {
    const { adapter, state } = fakeAdapter();
    const ev = makeFakeSpeechEvents();
    await createSpeechSession(adapter, { lang: 'en-US', events: ev }).start();
    state.events?.onError('aborted');
    state.events?.onError('network', 'x');
    expect(ev.onError.mock.calls).toEqual([['network', 'x']]);
  });

  it('a rejected start still ends, clears timers and rethrows', async () => {
    const { adapter, state } = fakeAdapter(() => Promise.reject(new Error('nope')));
    const ev = makeFakeSpeechEvents();
    await expect(createSpeechSession(adapter, { lang: 'en-US', events: ev }).start()).rejects.toThrow('nope');
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20000);
    expect(state.native?.stop).not.toHaveBeenCalled();
  });

  it('abort ends the session even when the adapter never sends end', async () => {
    const { adapter, state } = fakeAdapter();
    const ev = makeFakeSpeechEvents();
    const s = createSpeechSession(adapter, { lang: 'en-US', events: ev });
    await s.start();
    s.abort();
    expect(state.native?.abort).toHaveBeenCalledTimes(1);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
    s.stop();
    expect(state.native?.stop).not.toHaveBeenCalled();
  });
});
