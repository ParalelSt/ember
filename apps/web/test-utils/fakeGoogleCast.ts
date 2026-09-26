import { vi } from 'vitest';
import type { GCastGlobals, GCastSession } from '@/lib/cast/googleCast';

/** Test double for Google's Cast Web Sender SDK globals (window.cast and
 *  window.chrome.cast), just the parts Ember touches. Test-only. */
export function makeFakeCastGlobals() {
  const ctxListeners = new Map<string, ((e: unknown) => void)[]>();
  const players: FakeRemotePlayer[] = [];
  class FakeRemotePlayer {
    playerState: string | null = null;
    currentTime = 0;
    duration = 0;
    isPaused = true;
    canControlVolume = true;
    volumeLevel = 1;
    constructor() {
      players.push(this);
    }
  }
  const controllers: FakeController[] = [];
  class FakeController {
    listeners: (() => void)[] = [];
    playOrPause = vi.fn();
    seek = vi.fn();
    stop = vi.fn();
    setVolumeLevel = vi.fn();
    constructor(public player: FakeRemotePlayer) {
      controllers.push(this);
    }
    addEventListener(_t: string, cb: () => void) {
      this.listeners.push(cb);
    }
    fire() {
      for (const cb of this.listeners) cb();
    }
  }
  const session = {
    loadMedia: vi.fn<(req: unknown) => Promise<unknown>>(async () => undefined),
    media: null as { playerState?: string; idleReason?: string | null } | null,
    getMediaSession() {
      return this.media;
    },
    getCastDevice: () => ({ friendlyName: 'Living Room TV' }),
    endSession: vi.fn(),
  };
  const ctx = {
    castState: 'NOT_CONNECTED',
    current: null as GCastSession | null,
    setOptions: vi.fn(),
    addEventListener(type: string, cb: (e: unknown) => void) {
      ctxListeners.set(type, [...(ctxListeners.get(type) ?? []), cb]);
    },
    getCastState() {
      return this.castState;
    },
    getCurrentSession() {
      return this.current;
    },
    requestSession: vi.fn(async () => undefined),
    endCurrentSession: vi.fn(),
    fire(type: string, e: unknown) {
      for (const cb of ctxListeners.get(type) ?? []) cb(e);
    },
  };
  const globals: GCastGlobals = {
    cast: {
      framework: {
        CastContext: { getInstance: () => ctx },
        CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged', SESSION_STATE_CHANGED: 'sessionstatechanged' },
        CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', NOT_CONNECTED: 'NOT_CONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED' },
        SessionState: { SESSION_STARTED: 'SESSION_STARTED', SESSION_RESUMED: 'SESSION_RESUMED', SESSION_ENDED: 'SESSION_ENDED', SESSION_START_FAILED: 'SESSION_START_FAILED' },
        RemotePlayer: FakeRemotePlayer,
        RemotePlayerController: FakeController,
        RemotePlayerEventType: { ANY_CHANGE: 'anyChanged' },
      },
    },
    chrome: {
      cast: {
        AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
        Image: class { constructor(public url: string) {} },
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
          MediaInfo: class { streamType?: string; metadata?: unknown; constructor(public contentId: string, public contentType: string) {} },
          MusicTrackMediaMetadata: class { title?: string; artist?: string; albumName?: string; images?: unknown[] },
          LoadRequest: class { autoplay?: boolean; currentTime?: number; constructor(public media: unknown) {} },
          StreamType: { BUFFERED: 'BUFFERED' },
        },
      },
    },
  };
  return { globals, ctx, session, players, controllers };
}
