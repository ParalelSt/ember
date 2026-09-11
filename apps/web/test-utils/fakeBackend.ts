import { vi, type Mock } from 'vitest';
import type {
  AudioBackend,
  AudioBackendEvents,
  LoadOptions,
  RemoteCommands,
} from '@/lib/playback/types';
import type { Track } from '@/types/track';

/** Test double for an AudioBackend, shared by the hooks/player tests.
 *
 *  Test-only: nothing in the app imports it (vitest.setup.ts is the same kind
 *  of file). Every method is a spy, the clock/paused/transitioning state is
 *  writable, and `remote` is whatever the code under test registered, so a
 *  test can fire the OS transport buttons the way a real shell would. */
export interface FakeBackend extends AudioBackend {
  /** What getCurrentTime() reports. */
  currentTime: number;
  /** What getDuration() reports. */
  durationSec: number;
  paused: boolean;
  transitioning: boolean;
  /** Remote commands the code under test wired up, null until it does. */
  remote: RemoteCommands | null;
  load: Mock<(url: string, opts: LoadOptions) => void>;
  play: Mock<() => void>;
  pause: Mock<() => void>;
  stop: Mock<() => void>;
  seek: Mock<(sec: number) => void>;
  setVolume: Mock<(v: number, opts?: { gain?: number }) => void>;
  setMetadata: Mock<(track: Track | null) => void>;
  setRemoteCommands: Mock<(cmds: RemoteCommands) => void>;
  destroy: Mock<() => void>;
}

export function makeFakeBackend(over: Partial<FakeBackend> = {}): FakeBackend {
  const b: FakeBackend = {
    currentTime: 0,
    durationSec: 0,
    paused: true,
    transitioning: false,
    remote: null,
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMetadata: vi.fn(),
    setRemoteCommands: vi.fn((cmds: RemoteCommands) => {
      b.remote = cmds;
    }),
    destroy: vi.fn(),
    getCurrentTime: () => b.currentTime,
    getDuration: () => b.durationSec,
    isPaused: () => b.paused,
    isTransitioning: () => b.transitioning,
    ...over,
  };
  return b;
}

/** A minimal Track, overridable field by field. */
export function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: 'art1',
    album: 'Night Shift',
    albumId: 'alb1',
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

/** The event callbacks a backend factory receives, as spies. */
export function makeFakeEvents(): AudioBackendEvents {
  return {
    onTime: vi.fn(),
    onDuration: vi.fn(),
    onEnded: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onError: vi.fn(),
  };
}
