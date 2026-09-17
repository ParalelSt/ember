/** Song-skip investigation: what the player does with the events a failing
 *  native engine sends it.
 *
 *  The desktop engine reports the end of its decoded source as `audio:ended`
 *  (apps/desktop/src-tauri/src/audio.rs, the position timer's `if empty`
 *  branch), and its source ends on ANY read failure as well as on a real end
 *  of track, and on a seek it cannot service. The Rust side of that is proven
 *  in apps/desktop/src-tauri/src/audio/skip_repro.rs; this is the other half:
 *  what the provider does when such an event arrives.
 *
 *  Tests whose name ends in "(bug)" describe today's behaviour, which is the
 *  reported fault; a fix flips them. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));

const fake = makeFakeBackend();
fake.load = vi.fn((_url: string, opts: LoadOptions) => {
  if (opts.autoplay) fake.play();
});
let capturedEvents: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (events: AudioBackendEvents) => {
    capturedEvents = events;
    return fake;
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

const FIRST = makeTrack({ id: 'youtube:first', title: 'First', durationSec: 200 });
const SECOND = makeTrack({ id: 'youtube:second', title: 'Second', durationSec: 200 });

function Harness() {
  const { prev } = usePlayer();
  return <button onClick={prev}>prev</button>;
}

function renderPlayer() {
  render(
    <PlayerProvider>
      <Harness />
    </PlayerProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedEvents = null;
  fake.currentTime = 0;
  fake.durationSec = 200;
  fake.paused = false;
  usePlayerStore.setState({
    queue: [FIRST, SECOND],
    index: 0,
    position: 0,
    duration: 200,
    isPlaying: true,
    context: { type: 'album', id: 'alb1' },
    baseCount: 2,
    loopMode: 'off',
  });
});

describe('a premature "ended" from the engine', () => {
  it('starts the next song when the engine says a track ended 30s into a 200s song (bug)', () => {
    renderPlayer();
    fake.load.mockClear();
    fake.currentTime = 30;

    // What the desktop engine emits when its HTTP source dies mid-song, or
    // when a seek left the demuxer unable to read the next packet: the very
    // same event a genuinely finished track produces.
    act(() => {
      capturedEvents?.onEnded();
    });

    expect(usePlayerStore.getState().index).toBe(1);
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe(SECOND.id);
    expect(fake.load).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ autoplay: true }));
  });

  it('cannot tell a failure from a finished track: position and duration are not consulted', () => {
    renderPlayer();
    // A finished track and a failed one look identical here: the only inputs
    // are the event itself and the queue.
    fake.currentTime = 199;
    act(() => {
      capturedEvents?.onEnded();
    });
    const afterReal = usePlayerStore.getState().index;

    act(() => {
      usePlayerStore.setState({ index: 0 });
    });
    fake.currentTime = 2;
    act(() => {
      capturedEvents?.onEnded();
    });

    expect(usePlayerStore.getState().index).toBe(afterReal);
  });

  it('restarts the current song under loop-one, which the native engine cannot do once its source has ended', () => {
    usePlayerStore.setState({ loopMode: 'one' });
    renderPlayer();
    fake.seek.mockClear();
    fake.play.mockClear();

    act(() => {
      capturedEvents?.onEnded();
    });

    // seek(0) + play() on a sink whose source already ended is a no-op in the
    // Rust engine (nothing is left to seek), so loop-one goes silent after a
    // failure rather than repeating the song.
    expect(fake.seek).toHaveBeenCalledWith(0);
    expect(fake.play).toHaveBeenCalled();
    expect(usePlayerStore.getState().index).toBe(0);
  });
});

describe('Previous', () => {
  it('restarts the current song with seek(0) past the 3s mark, which is the seek the engine turns into an end of track (bug)', () => {
    renderPlayer();
    fake.currentTime = 42;
    fake.seek.mockClear();

    fireEvent.click(screen.getByText('prev'));

    // Provider-side this is correct (the usual transport convention). It is
    // the seek itself that is fatal on the desktop engine: see
    // seeking_back_to_the_start_ends_the_track_bug in skip_repro.rs, where
    // the sink goes empty and the engine then emits audio:ended, i.e.
    // pressing Previous plays the NEXT song.
    expect(fake.seek).toHaveBeenCalledWith(0);
    expect(usePlayerStore.getState().index).toBe(0);
  });
});
