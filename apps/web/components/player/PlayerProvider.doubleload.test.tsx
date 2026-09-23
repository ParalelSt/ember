/** One load per track change.
 *
 *  The fault: play, next, prev and auto-advance each loaded the new track
 *  directly (to keep the user-gesture token) and then the "current track
 *  changed" effect loaded it a second time. The second load cut off the
 *  first one's play(), so the player flickered paused then playing on every
 *  change, the phone notification was told the same, and the desktop engine
 *  got two loads (and two "Couldn't load" toasts on a failure).
 *
 *  The loads that ARE wanted still happen: replaying the song that is already
 *  current, and the silent, autoplay-off load that restores a persisted queue
 *  after a reload. Loop-one repeats by seeking, with no load at all.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';
import type { Track } from '@/types/track';

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));

/** Which shell the provider thinks it is in. Read when the backend is built,
 *  which is once per mount, so each test can pick its own. */
const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'tauri' | 'android' }));
vi.mock('@/lib/playback/detectShell', () => ({
  detectShell: () => (shell.kind === 'android' ? 'capacitor' : shell.kind),
}));
vi.mock('@/lib/playback/nativeBridge', () => ({
  createNativeBackend: vi.fn(),
  nativeBackendReady: () => true,
}));

const fake = makeFakeBackend();
fake.load = vi.fn((_url: string, opts: LoadOptions) => {
  if (opts.autoplay) fake.play();
});
const setQueue = vi.fn();
let ev: AudioBackendEvents | null = null;
const capture = (events: AudioBackendEvents) => {
  ev = events;
  return fake;
};
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend: (e: AudioBackendEvents) => capture(e) }));
vi.mock('@/lib/playback/tauriBackend', () => ({ createTauriBackend: (e: AudioBackendEvents) => capture(e) }));
vi.mock('@/lib/playback/capacitorBackend', () => ({ createCapacitorBackend: (e: AudioBackendEvents) => capture(e) }));
vi.mock('@/lib/playback/androidBackend', () => ({
  androidPluginPresent: () => true,
  createAndroidBackend: (events: AudioBackendEvents) => {
    ev = events;
    return Object.assign(fake, { setQueue, next: vi.fn(), prev: vi.fn() });
  },
}));

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', streamUrl: '/s/a', durationSec: 200 });
const B = makeTrack({ id: 'youtube:b', sourceId: 'b', streamUrl: '/s/b', durationSec: 200 });
const C = makeTrack({ id: 'youtube:c', sourceId: 'c', streamUrl: '/s/c', durationSec: 200 });

function Harness({ track = C }: { track?: Track }) {
  const { playTrack, next, prev } = usePlayer();
  return (
    <>
      <button onClick={() => playTrack(track, [A, B, C], { type: 'album', id: 'x' } as never)}>play</button>
      <button onClick={() => next()}>next</button>
      <button onClick={() => prev()}>prev</button>
    </>
  );
}

const urls = () => fake.load.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  shell.kind = 'web';
  ev = null;
  delete (fake as { setQueue?: unknown }).setQueue;
  fake.currentTime = 0;
  fake.paused = true;
  usePlayerStore.setState({
    queue: [A, B, C], index: 0, position: 0, isPlaying: false, duration: 0,
    context: null, loopMode: 'off',
  });
});

describe.each(['web', 'tauri'] as const)('one load per track change (%s)', (kind) => {
  beforeEach(() => {
    shell.kind = kind;
  });

  it('playTrack of a different track loads it once', () => {
    render(<PlayerProvider><Harness /></PlayerProvider>);
    fake.load.mockClear();
    fireEvent.click(screen.getByText('play'));
    expect(urls()).toEqual(['/s/c']);
  });

  it('next loads the next track once', () => {
    render(<PlayerProvider><Harness /></PlayerProvider>);
    fake.load.mockClear();
    fireEvent.click(screen.getByText('next'));
    expect(urls()).toEqual(['/s/b']);
  });

  it('prev loads the previous track once', () => {
    usePlayerStore.setState({ index: 2 });
    render(<PlayerProvider><Harness /></PlayerProvider>);
    fake.load.mockClear();
    fireEvent.click(screen.getByText('prev'));
    expect(urls()).toEqual(['/s/b']);
  });

  it('auto-advance loads the next track once, with autoplay', () => {
    render(<PlayerProvider><Harness track={A} /></PlayerProvider>);
    fireEvent.click(screen.getByText('play'));
    fake.load.mockClear();
    fake.currentTime = 200;
    act(() => { usePlayerStore.setState({ duration: 200, position: 200 }); });
    act(() => { ev!.onEnded(); });
    expect(fake.load.mock.calls).toEqual([['/s/b', expect.objectContaining({ autoplay: true })]]);
  });

  it('replaying the current song still reloads it', () => {
    render(<PlayerProvider><Harness /></PlayerProvider>);
    fireEvent.click(screen.getByText('play'));
    fake.load.mockClear();
    fireEvent.click(screen.getByText('play'));
    expect(urls()).toEqual(['/s/c']);
  });

  it('loop-one repeats by seeking to 0, without a reload', () => {
    render(<PlayerProvider><Harness track={A} /></PlayerProvider>);
    fireEvent.click(screen.getByText('play'));
    act(() => { usePlayerStore.setState({ loopMode: 'one', duration: 200, position: 200 }); });
    fake.load.mockClear();
    fake.play.mockClear();
    fake.currentTime = 200;
    act(() => { ev!.onEnded(); });
    expect(fake.load).not.toHaveBeenCalled();
    expect(fake.seek).toHaveBeenCalledWith(0);
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('a reload restores the persisted track once, paused, at its position', () => {
    usePlayerStore.setState({ index: 1, position: 42 });
    render(<PlayerProvider><Harness /></PlayerProvider>);
    expect(fake.load.mock.calls).toEqual([['/s/b', { autoplay: false, startAt: 42 }]]);
    expect(fake.play).not.toHaveBeenCalled();
  });
});

describe('android (the native player owns the queue)', () => {
  beforeEach(() => {
    shell.kind = 'android';
  });

  it('a native advance loads nothing, and a later jump back to the old song is not skipped', () => {
    render(<PlayerProvider><Harness track={A} /></PlayerProvider>);
    fireEvent.click(screen.getByText('play'));
    setQueue.mockClear();
    // The native player moved on to B by itself: mirror it, load nothing.
    act(() => { ev!.onQueueIndex!(1); });
    expect(setQueue).not.toHaveBeenCalled();
    // Now the app moves back to A. B is what native is playing, so A must be
    // handed over, not mistaken for "already loaded".
    setQueue.mockClear();
    vi.useFakeTimers({ now: Date.now() + 1000, toFake: ['Date'] });
    try {
      act(() => { usePlayerStore.setState({ index: 0 }); });
    } finally {
      vi.useRealTimers();
    }
    expect(setQueue).toHaveBeenCalledWith([A, B, C], 0, true);
  });
});
