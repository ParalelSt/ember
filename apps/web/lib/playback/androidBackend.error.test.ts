import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndroidBackend, nativeErrorLog } from './androidBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';
import { logger } from '@/lib/logger/client';

// "audio: Source error" and "audio: playback error" reached the automatic
// bug reports from the Android app with nothing else to go on (Luka and
// Mihajlo, 2026-10-15). The second was not even a failure: the native player
// announcing that its error had CLEARED (play pressed again). App builds with
// PlayerErrors.kt send what failed and whether it was an outside failure.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), breadcrumb: vi.fn() } }));

type Listener = (d: unknown) => void;

function installPlugin() {
  const listeners = new Map<string, Listener>();
  const plugin = {
    addListener: vi.fn((event: string, cb: Listener) => { listeners.set(event, cb); return Promise.resolve({ remove: () => {} }); }),
    setQueue: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(() => new Promise(() => {})),
    drainUnplayable: vi.fn().mockResolvedValue({ notices: [] }),
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return { emit: (event: string, d: unknown) => listeners.get(event)?.(d) };
}

const online = { trackId: 'youtube:abc', online: true };

beforeEach(() => vi.clearAllMocks());
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

describe('nativeErrorLog', () => {
  it('a host refusal from a new app build is a warning, with what failed', () => {
    const log = nativeErrorLog({
      message: 'Source error', errorCodeName: 'ERROR_CODE_IO_BAD_HTTP_STATUS', code: 2004, httpStatus: 403,
      trackId: 'youtube:lNBXu1wSYrw', station: false, offline: false, expected: true,
    }, online);
    expect(log).toEqual({
      level: 'warn',
      message: 'Source error',
      data: { trackId: 'youtube:lNBXu1wSYrw', station: false, offline: false, errorCodeName: 'ERROR_CODE_IO_BAD_HTTP_STATUS', code: 2004, httpStatus: 403 },
    });
  });

  it('a decoder failure stays an error, with its code', () => {
    const log = nativeErrorLog({ message: 'Renderer error', errorCodeName: 'ERROR_CODE_DECODING_FAILED', code: 4003, expected: false }, online);
    expect(log?.level).toBe('error');
    expect(log?.data).toMatchObject({ errorCodeName: 'ERROR_CODE_DECODING_FAILED', code: 4003, trackId: 'youtube:abc' });
  });

  it('an old build: a station or an offline phone is a warning, anything else an error', () => {
    expect(nativeErrorLog({ message: 'Source error' }, online)?.level).toBe('error');
    expect(nativeErrorLog({ message: 'Source error' }, { trackId: 'station:0a1b', online: true })?.level).toBe('warn');
    expect(nativeErrorLog({ message: 'Source error' }, { trackId: 'youtube:abc', online: false })?.level).toBe('warn');
  });

  it('an old build offline: a failed load is a warning, a decoder failure stays an error', () => {
    const offline = { trackId: 'youtube:abc', online: false };
    expect(nativeErrorLog({ message: 'Source error' }, offline)?.level).toBe('warn');
    expect(nativeErrorLog({ message: 'MediaCodecAudioRenderer error, index=1, format=Format(1, null, null, audio/mp4a-latm), format_supported=YES' }, offline)?.level).toBe('error');
    expect(nativeErrorLog({ message: 'Unexpected runtime error' }, offline)?.level).toBe('error');
  });

  it('a new build decides offline itself: a downloaded song that will not play offline is an error', () => {
    const log = nativeErrorLog({
      message: 'Source error', errorCodeName: 'ERROR_CODE_IO_FILE_NOT_FOUND', code: 2005, offline: true, local: true, expected: false,
    }, { trackId: 'youtube:abc', online: false });
    expect(log?.level).toBe('error');
    expect(log?.data).toMatchObject({ offline: true, local: true });
  });

  it('an old build announcing a cleared error is no error at all', () => {
    expect(nativeErrorLog({ message: 'playback error' }, online)).toBeNull();
  });
});

describe('androidBackend error event', () => {
  it('logs by the verdict and still tells the provider', () => {
    const n = installPlugin();
    const events = makeFakeEvents();
    createAndroidBackend(events);
    n.emit('error', { message: 'Source error', errorCodeName: 'ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', code: 2001, expected: true });
    expect(logger.warn).toHaveBeenCalledWith('audio', 'Source error', expect.objectContaining({ code: 2001 }));
    expect(logger.error).not.toHaveBeenCalled();
    expect(events.onError).toHaveBeenCalledTimes(1);
  });

  it('a cleared error (an old build\'s "playback error") is a breadcrumb, not a second failure', () => {
    const n = installPlugin();
    const events = makeFakeEvents();
    createAndroidBackend(events);
    n.emit('error', { message: 'playback error' });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.breadcrumb).toHaveBeenCalledWith('audio', 'native error cleared', expect.anything());
    expect(events.onError).not.toHaveBeenCalled();
  });
});
