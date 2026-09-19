/** A song that will not load, provider side.
 *
 *  The fault: when the host could not produce audio (its yt-dlp download
 *  failed and the live stream it fell back to could not stand in), the desktop
 *  app sat on the song for 25 seconds, then swapped its native engine for web
 *  audio and waited all over again, and the listener was never told anything.
 *  Two things are asserted here, both about the moment after a failure:
 *
 *   - the listener gets a message naming the song, once the server has said it
 *     has nothing against the track (a track that IS dead gets the skip
 *     message from the availability probe instead);
 *   - the web-audio fallback is only spent when it could actually help. A
 *     failure the engine blames on the HOST does not swap engines, because the
 *     browser would ask the same server for the same bytes, and the swap costs
 *     the whole session its OS media keys.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

/** The native (tauri) engine, whose errors carry the verdict under test. */
const nativeEngine = makeFakeBackend();
nativeEngine.load = vi.fn((_url: string, opts: LoadOptions) => {
  if (opts.autoplay) nativeEngine.play();
});
let nativeEvents: AudioBackendEvents | null = null;
const createTauriBackend = vi.hoisted(() => vi.fn());
vi.mock('@/lib/playback/tauriBackend', () => ({ createTauriBackend }));

/** What the fallback would build. Its existence is the thing being counted. */
const webEngine = makeFakeBackend();
const createWebBackend = vi.hoisted(() => vi.fn());
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend }));

// A tauri shell with a working native engine, which is what the desktop app is.
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => 'tauri' }));
vi.mock('@/lib/playback/nativeBridge', () => ({
  createNativeBackend: vi.fn(),
  nativeBackendReady: () => true,
}));

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));

/** The probe stands in for the server's answer about the failing track.
 *  `stillPlayable` decides which of the two answers it gives. */
const probeState = vi.hoisted(() => ({ stillPlayable: true }));
const probe = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({
  useAvailabilityProbe: () => probe,
}));

const TRACK = makeTrack({ id: 'youtube:one', title: 'Unloadable Song', durationSec: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  nativeEvents = null;
  probeState.stillPlayable = true;
  createTauriBackend.mockImplementation((events: AudioBackendEvents) => {
    nativeEvents = events;
    return nativeEngine;
  });
  createWebBackend.mockImplementation(() => webEngine);
  probe.mockImplementation((onStillPlayable?: (t: { title: string }) => void) => {
    if (probeState.stillPlayable) onStillPlayable?.(TRACK);
  });
  usePlayerStore.setState({
    queue: [TRACK],
    index: 0,
    position: 0,
    duration: 200,
    isPlaying: true,
    loopMode: 'off',
    context: null,
    baseCount: 1,
  });
  render(<PlayerProvider>{null}</PlayerProvider>);
});

describe('a song the host cannot serve', () => {
  it('does not spend the web-audio fallback on a failure web audio cannot fix', () => {
    act(() => nativeEvents!.onError({ canRetryOnWebAudio: false }));

    expect(createWebBackend).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('tells the listener which song would not load', () => {
    act(() => nativeEvents!.onError({ canRetryOnWebAudio: false }));

    expect(toast.error).toHaveBeenCalledWith('Couldn\'t load "Unloadable Song"');
  });

  it('leaves a track the server calls dead to the skip message instead', () => {
    probeState.stillPlayable = false;
    act(() => nativeEvents!.onError({ canRetryOnWebAudio: false }));

    // One message per failure: the probe flags and skips that case itself.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps the playhead where the listener was, so a retry resumes', () => {
    usePlayerStore.setState({ position: 87 });
    act(() => nativeEvents!.onError({ canRetryOnWebAudio: false }));

    expect(usePlayerStore.getState().position).toBe(87);
    expect(usePlayerStore.getState().index).toBe(0);
  });

  it('still swaps to web audio when the ENGINE was the problem', () => {
    // A codec rodio was not built for, no output device: the browser may well
    // cope, so this failure keeps the old behaviour.
    act(() => nativeEvents!.onError({ canRetryOnWebAudio: true }));

    expect(createWebBackend).toHaveBeenCalled();
  });

  it('still swaps to web audio for an error with no verdict at all', () => {
    act(() => nativeEvents!.onError());

    expect(createWebBackend).toHaveBeenCalled();
  });
});
