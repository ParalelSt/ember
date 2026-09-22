import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useVoiceSearch } from './useVoiceSearch';
import { SpeechStartError, type NativeSpeech, type SpeechAdapter, type SpeechEvents } from '@/lib/speech/types';

const toast = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger }));

const shell = vi.hoisted(() => ({ value: 'web' as 'web' | 'capacitor' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.value }));

// One fake native per start, recording calls and exposing the events the
// session handed it, so tests can play the recognizer's part.
const fake = vi.hoisted(() => ({
  adapter: null as SpeechAdapter | null,
  reason: undefined as 'no-bridge' | 'no-recognizer' | undefined,
  natives: [] as Array<{ lang: string; events: SpeechEvents; stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> }>,
  startImpl: null as null | ((events: SpeechEvents) => Promise<void>),
}));
vi.mock('@/lib/speech/selectAdapter', () => ({
  selectSpeechAdapter: () => ({ adapter: fake.adapter, reason: fake.reason }),
}));

function makeAdapter(): SpeechAdapter {
  return {
    kind: 'web',
    create(): NativeSpeech {
      const entry = { lang: '', events: null as unknown as SpeechEvents, stop: vi.fn(), abort: vi.fn() };
      return {
        start(lang, events) {
          entry.lang = lang;
          entry.events = events;
          fake.natives.push(entry);
          return fake.startImpl ? fake.startImpl(events) : Promise.resolve();
        },
        stop: entry.stop,
        abort: entry.abort,
      };
    },
  };
}

beforeEach(() => {
  fake.adapter = makeAdapter();
  fake.reason = undefined;
  fake.natives = [];
  fake.startImpl = null;
  shell.value = 'web';
});
afterEach(() => vi.clearAllMocks());

async function startListening(onTranscript = vi.fn()) {
  const hook = renderHook(() => useVoiceSearch(onTranscript));
  await act(async () => hook.result.current.toggle());
  return { ...hook, onTranscript, native: fake.natives[0] };
}

describe('useVoiceSearch', () => {
  it('reports unsupported in the server render', () => {
    let seen: boolean | null = null;
    function Probe() {
      seen = useVoiceSearch(() => {}).supported;
      return null;
    }
    renderToString(<Probe />);
    expect(seen).toBe(false);
  });

  it('is supported with an adapter and not without one', () => {
    expect(renderHook(() => useVoiceSearch(() => {})).result.current.supported).toBe(true);
    fake.adapter = null;
    expect(renderHook(() => useVoiceSearch(() => {})).result.current.supported).toBe(false);
  });

  it('toggle starts with navigator.language and sets listening', async () => {
    const { result, native } = await startListening();
    expect(native.lang).toBe(navigator.language || 'en-US');
    expect(result.current.listening).toBe(true);
  });

  it('partial and final reach the callback, empty text is skipped', async () => {
    const { native, onTranscript } = await startListening();
    act(() => {
      native.events.onPartial('');
      native.events.onPartial('daft');
      native.events.onFinal('daft punk');
    });
    expect(onTranscript.mock.calls).toEqual([
      ['daft', false],
      ['daft punk', true],
    ]);
  });

  it('end clears listening', async () => {
    const { result, native } = await startListening();
    act(() => native.events.onEnd());
    expect(result.current.listening).toBe(false);
  });

  it('second toggle stops', async () => {
    const { result, native } = await startListening();
    act(() => result.current.toggle());
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('unmount aborts', async () => {
    const { unmount, native } = await startListening();
    unmount();
    expect(native.abort).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['permission-denied', 'Allow microphone access to use voice search.', false],
    ['network', 'Voice search needs an internet connection right now.', true],
    ['unavailable', "Voice search isn't supported in this browser: try Chrome.", true],
  ] as const)('error %s toasts its copy', async (kind, copy, logged) => {
    const { native } = await startListening();
    act(() => {
      native.events.onError(kind, 'd');
      native.events.onEnd();
    });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy);
    expect(logger.error).toHaveBeenCalledTimes(logged ? 1 : 0);
  });

  it.each(['no-speech', 'aborted'] as const)('%s stays quiet', async (kind) => {
    const { native } = await startListening();
    act(() => native.events.onError(kind));
    expect(toast.error).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a rejected start leaves listening false and uses the rejection reason for the copy', async () => {
    shell.value = 'tauri';
    fake.startImpl = (events) => {
      events.onError('unavailable', 'command speech_start not found');
      events.onEnd();
      return Promise.reject(new SpeechStartError('unavailable', 'not found', 'no-bridge'));
    };
    const { result } = await startListening();
    expect(result.current.listening).toBe(false);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Update the Ember app to use voice search.');
  });

  it('a shell error with no reason says the device has no recognizer', async () => {
    shell.value = 'capacitor';
    fake.startImpl = () => Promise.reject(new SpeechStartError('unavailable'));
    const { result } = await startListening();
    expect(result.current.listening).toBe(false);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Voice search isn't available on this device.");
  });

  it('a tap after the session ended starts a new one', async () => {
    const { result, native } = await startListening();
    act(() => native.events.onEnd());
    await act(async () => result.current.toggle());
    expect(fake.natives).toHaveLength(2);
    expect(result.current.listening).toBe(true);
  });
});
