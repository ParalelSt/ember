/** The song skip, provider side: what the player does with the events a
 *  failing engine sends it.
 *
 *  The desktop engine reports the end of its decoded source as `audio:ended`
 *  (apps/desktop/src-tauri/src/audio.rs, the position timer's `if empty`
 *  branch), and a source can end for reasons that are not a finished song.
 *  The engine now says so itself (see skip_repro.rs), but the provider is the
 *  last line: an `ended` that arrives while the playhead is far from the end
 *  of a song is treated as a failure rather than as a reason to play the next
 *  one. These tests started as reproductions of the skip and now assert that
 *  behaviour. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import { logger } from '@/lib/logger/client';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
// A skip has to be explainable afterwards, so the breadcrumbs are asserted on.
vi.mock('@/lib/logger/client', () => ({
  logger: {
    boot: vi.fn(),
    setContext: vi.fn(),
    breadcrumb: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

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
    context: { type: 'album', albumId: 'alb1', albumTitle: 'Night Shift' },
    baseCount: 2,
    loopMode: 'off',
  });
});

describe('a premature "ended" from the engine', () => {
  it('does not advance when the engine says a track ended 30s into a 200s song', () => {
    renderPlayer();
    fake.load.mockClear();
    fake.currentTime = 30;

    // What the desktop engine emits when its HTTP source dies mid-song, or
    // when a seek left the demuxer unable to read the next packet: the very
    // same event a genuinely finished track produces.
    act(() => {
      capturedEvents?.onEnded();
    });

    expect(usePlayerStore.getState().index).toBe(0);
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe(FIRST.id);
    // The error path ran instead: the song stays, nothing new is loaded.
    expect(fake.load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('leaves a breadcrumb naming the position and the duration', () => {
    renderPlayer();
    fake.currentTime = 30;

    act(() => {
      capturedEvents?.onEnded();
    });

    // A skip used to be invisible in a bug report. Both the ordinary
    // breadcrumb and the error carry the two numbers that explain it.
    expect(logger.breadcrumb).toHaveBeenCalledWith(
      'playback',
      'ended',
      expect.objectContaining({ trackId: FIRST.id, position: 30, duration: 200 }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'playback',
      expect.stringContaining('ended a track early'),
      expect.objectContaining({ position: 30, duration: 200 }),
    );
  });

  it('tells a failure from a finished track by the playhead', () => {
    renderPlayer();
    // A track that really finished: the queue advances exactly as before.
    fake.currentTime = 199;
    act(() => {
      capturedEvents?.onEnded();
    });
    expect(usePlayerStore.getState().index).toBe(1);

    // The same event two seconds into the next song is a failure.
    fake.currentTime = 2;
    act(() => {
      capturedEvents?.onEnded();
    });
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('still advances when the engine ends a track a second short of its length', () => {
    renderPlayer();
    // Backends report the last second coarsely; an end that close is real.
    fake.currentTime = 199.2;

    act(() => {
      capturedEvents?.onEnded();
    });

    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('advances on an ended with no known duration, having nothing to compare against', () => {
    // Neither the catalog nor the engine knows how long this is (an upload
    // whose length was never measured, say).
    usePlayerStore.setState({
      queue: [makeTrack({ id: 'youtube:unknown', durationSec: 0 }), SECOND],
      duration: 0,
    });
    renderPlayer();
    fake.currentTime = 0;
    fake.durationSec = 0;

    act(() => {
      capturedEvents?.onEnded();
    });

    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('restarts the current song under loop-one when it really finished', () => {
    usePlayerStore.setState({ loopMode: 'one' });
    renderPlayer();
    fake.currentTime = 199;
    fake.seek.mockClear();
    fake.play.mockClear();

    act(() => {
      capturedEvents?.onEnded();
    });

    expect(fake.seek).toHaveBeenCalledWith(0);
    expect(fake.play).toHaveBeenCalled();
    expect(usePlayerStore.getState().index).toBe(0);
  });

  it('does not replay a dead stream under loop-one when the song had not finished', () => {
    usePlayerStore.setState({ loopMode: 'one' });
    renderPlayer();
    fake.currentTime = 12;
    fake.seek.mockClear();
    fake.play.mockClear();

    act(() => {
      capturedEvents?.onEnded();
    });

    // seek(0) + play() on a sink whose source already ended is a no-op in the
    // Rust engine, so loop-one went silent after a failure instead of
    // repeating the song. The error path retries it for real.
    expect(fake.seek).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().index).toBe(0);
  });
});

describe('a mid-song failure the web backend reports as an error', () => {
  it('stops the song but keeps the playhead, so replaying it resumes where it died', () => {
    renderPlayer();
    // Where the listener actually was when the stream died.
    act(() => {
      capturedEvents?.onTime(97);
    });
    fake.currentTime = 97;

    act(() => {
      capturedEvents?.onError();
    });

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    // The listener's next move is to play the same song again; it should pick
    // up at 1:37, not start over.
    expect(usePlayerStore.getState().position).toBe(97);
  });

  it('keeps the playhead when an ended arrives mid-song too', () => {
    renderPlayer();
    act(() => {
      capturedEvents?.onTime(64);
    });
    fake.currentTime = 64;

    act(() => {
      capturedEvents?.onEnded();
    });

    expect(usePlayerStore.getState().index).toBe(0);
    expect(usePlayerStore.getState().position).toBe(64);
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
