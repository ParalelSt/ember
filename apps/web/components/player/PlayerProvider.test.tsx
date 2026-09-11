import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

// PlayerProvider renders no links or other DOM of its own (just the
// context provider), so unlike other component tests this one needs no
// next/link mock.
vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));

// The backend factory: swapped for the shared fake so no real <audio>
// element or Web Audio graph gets built. `load` mimics the one thing the
// real webBackend.load() does synchronously that this test cares about:
// starting playback when asked to autoplay (in production that's `a.play()`
// on the underlying element; here it's the backend's own `play()` spy).
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

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/hooks/useLyrics', () => ({
  useQueryLyrics: () => ({ data: undefined }),
}));

// Discord presence, radio-extend, shortcuts, remote commands and the
// availability probe are each unit-tested on their own
// (hooks/player/*.test.ts); stub them here so this test exercises only what
// PlayerProvider itself wires: backend calls and the position-persistence
// path. (The probe also calls useQueryClient, which this tree has no
// provider for.)
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));

const TRACK_ID = 'youtube:new-track';

function Harness() {
  const { playTrack } = usePlayer();
  const track = makeTrack({ id: TRACK_ID });
  return <button onClick={() => playTrack(track)}>play</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedEvents = null;
  fake.currentTime = 0;
  fake.durationSec = 0;
  fake.paused = true;
  // Fresh queue and playhead each test, same as a cold app start.
  usePlayerStore.setState({
    queue: [], index: -1, position: 0, isPlaying: false, duration: 0, context: null,
  });
});

describe('PlayerProvider', () => {
  it('loads and plays the track passed to playTrack, once', () => {
    // Seed the queue with a track sharing playTrack's id: the mount-time
    // auto-advance effect (queue -> current -> load) then already owns the
    // "load on track change" case tested by hooks/player, and playTrack's
    // own click is the only load left to observe below.
    usePlayerStore.setState({ queue: [makeTrack({ id: TRACK_ID })], index: 0 });
    render(<PlayerProvider><Harness /></PlayerProvider>);
    fake.load.mockClear();
    fake.play.mockClear();

    fireEvent.click(screen.getByText('play'));

    expect(fake.load).toHaveBeenCalledTimes(1);
    expect(fake.load).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ autoplay: true }),
    );
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('resets the stored position for a track that does not own it (startAt path)', () => {
    // A different track owns the stored playhead from a previous session.
    usePlayerStore.setState({
      queue: [makeTrack({ id: 'youtube:old-track' })], index: 0, position: 42,
    });
    render(<PlayerProvider><Harness /></PlayerProvider>);

    fireEvent.click(screen.getByText('play'));

    // startAt() hands the playhead to the NEW track; since the stored
    // position belonged to youtube:old-track, the new one starts at 0, not
    // at the leftover 42 (see lib/playback/resumePosition.ts).
    expect(usePlayerStore.getState().position).toBe(0);
  });

  it('persists the position when the backend reports a pause', () => {
    usePlayerStore.setState({ queue: [makeTrack({ id: TRACK_ID })], index: 0 });
    render(<PlayerProvider><Harness /></PlayerProvider>);
    fireEvent.click(screen.getByText('play'));

    fake.currentTime = 77;
    fake.durationSec = 200;
    act(() => {
      capturedEvents?.onPause();
    });

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().position).toBe(77);
  });
});
