/** Bughunt 2026-09-25 D7: the swap to web audio after a native failure
 *  started the song whether or not anyone had asked for it to play.
 *
 *  Harness copied from PlayerProvider.fastfail.test.tsx. Original header:
 *
 *  A song that will not load, provider side.
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
import { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
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

const probe = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({
  useAvailabilityProbe: () => probe,
}));

const TRACK = makeTrack({ id: 'youtube:one', title: 'Unloadable Song', durationSec: 200 });


const cap: { player: ReturnType<typeof usePlayer> | null } = { player: null };
function Capture() {
  const p = usePlayer();
  useEffect(() => {
    cap.player = p;
  });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeEvents = null;
  cap.player = null;
  createTauriBackend.mockImplementation((events: AudioBackendEvents) => {
    nativeEvents = events;
    return nativeEngine;
  });
  createWebBackend.mockImplementation(() => webEngine);
  probe.mockImplementation(() => {});
  // A persisted queue, as at launch: nothing has been pressed yet.
  usePlayerStore.setState({
    queue: [TRACK],
    index: 0,
    position: 42,
    duration: 200,
    isPlaying: false,
    loopMode: 'off',
    context: null,
    baseCount: 1,
  });
  render(<PlayerProvider><Capture /></PlayerProvider>);
});

describe('the web-audio fallback (D7)', () => {
  it('at launch, loads the restored song paused: it does not start by itself', () => {
    // The restored song is one the native engine cannot decode (a webm the
    // host serves as is): its paused launch load fails, worth a web retry.
    expect(nativeEngine.load).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ autoplay: false }));
    act(() => nativeEvents!.onError({ canRetryOnWebAudio: true }));

    expect(createWebBackend).toHaveBeenCalled();
    expect(webEngine.load).toHaveBeenCalledTimes(1);
    expect(webEngine.load.mock.calls[0][1]).toMatchObject({ autoplay: false });
  });

  it('plays on web audio when the listener had asked for the song', () => {
    act(() => cap.player!.playTrack(TRACK, [TRACK]));
    act(() => nativeEvents!.onError({ canRetryOnWebAudio: true }));

    expect(webEngine.load).toHaveBeenCalledTimes(1);
    expect(webEngine.load.mock.calls[0][1]).toMatchObject({ autoplay: true });
  });
});
