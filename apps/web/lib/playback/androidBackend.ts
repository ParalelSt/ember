'use client';

import { logger } from '@/lib/logger/client';
import { nativeQueueContext, type QueueOrigin } from '@/lib/autoCache/native';
import type { Track } from '@/types/track';
import type { LoopMode } from '@/stores/usePlayerStore';
import type { OverlayEnd, OverlayHandle, OverlayResult } from '@/lib/pranks/overlayPlayer';
import type { AudioBackend, AudioBackendEvents, CreateAudioBackend, NativeOverlayOptions } from './types';

/** JS surface of the EmberPlayer Capacitor plugin (apps/mobile, Kotlin).
 *  Reached through the bridge Capacitor injects, never imported from npm:
 *  this web app is served by the host, so no plugin JS is ever bundled. */
interface NativeState {
  playing: boolean;
  position: number;
  duration: number;
  index: number;
  trackId: string | null;
  /** App builds from before the loop button reached native lack it. */
  loop?: LoopMode;
}
interface EmberPlayerPlugin {
  addListener(event: string, cb: (data: never) => void): unknown;
  /** `context`/`baseCount` feed the native auto cache's window; older app
   *  builds ignore them. */
  setQueue(o: {
    tracks: Track[];
    index: number;
    play: boolean;
    context?: { type: string } | null;
    baseCount?: number;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(o: { sec: number }): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Absent on app builds from before the loop button reached native. */
  setRepeat?(o: { mode: LoopMode }): Promise<void>;
  setVolume(o: { v: number }): Promise<void>;
  /** Absent on app builds from before native volume normalization. */
  setNormalize?(o: { enabled: boolean }): Promise<void>;
  getState(): Promise<NativeState>;
  /** What native is playing from. Absent on app builds from before it. */
  getQueue?(): Promise<{ tracks: Track[]; index: number }>;
  /** Only on app builds with the native prank overlay. */
  playOverlay?(o: NativeOverlayOptions & { id: string; url: string }): Promise<{ started: boolean; reason?: string }>;
  stopOverlay?(): Promise<void>;
}
interface OverlayEvent {
  id: string;
  phase: 'ended';
  reason: string;
  playedSec: number;
}

const OVERLAY_ENDS: readonly OverlayEnd[] = ['ended', 'stopped', 'cap', 'error'];
const LOOP_MODES: readonly LoopMode[] = ['off', 'all', 'one'];
/** If native never reports the end (the service died), give up this long
 *  after the cap so the receiver is not busy forever. */
export const OVERLAY_END_GRACE_MS = 5_000;
/** A saved queue waits at most this long for native to say what it has. */
export const NATIVE_QUEUE_WAIT_MS = 2_000;

function plugin(): EmberPlayerPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { EmberPlayer?: EmberPlayerPlugin } } }).Capacitor;
  return cap?.Plugins?.EmberPlayer ?? null;
}

export function androidPluginPresent(): boolean {
  return plugin() !== null;
}

/** A missing or broken bridge must never throw into the player. */
function call(p: unknown): void {
  if (p && typeof (p as Promise<void>).catch === 'function') void (p as Promise<void>).catch(() => {});
}

/** Android backend: the native Media3 player owns playback AND the queue, so
 *  the car keeps working when this WebView is gone. This object only forwards
 *  commands and mirrors what native reports. There is deliberately no fallback
 *  to WebView audio here: that path cannot drive the car and would hide the
 *  fault. */
export const createAndroidBackend: CreateAudioBackend = (events: AudioBackendEvents) => {
  let position = 0;
  let duration = 0;
  let paused = true;
  let index = -1;
  /** The loop mode native last reported (null until it first does), and the
   *  modes sent since that it has not reported yet. A report that matches one
   *  of those is our own change arriving, not a tap in the car, so it is not
   *  echoed back: echoing a stale one would fight the listener's latest tap. */
  let loop: LoopMode | null = null;
  let loopsInFlight: LoopMode[] = [];
  const p = plugin();

  const onLoop = (l: LoopMode | undefined) => {
    if (!l || !LOOP_MODES.includes(l) || l === loop) return;
    const first = loop === null;
    loop = l;
    const mine = loopsInFlight.indexOf(l);
    if (mine >= 0) {
      loopsInFlight = loopsInFlight.slice(mine + 1);
      return;
    }
    // The first report is only what native had when this WebView started;
    // the app's own saved mode is sent over it.
    if (first) return;
    loopsInFlight = [];
    events.onLoopMode?.(l);
  };

  const onState = (s: NativeState) => {
    paused = !s.playing;
    if (s.index !== index) {
      index = s.index;
      events.onQueueIndex?.(s.index);
    }
    if (s.duration !== duration) {
      duration = s.duration;
      events.onDuration(s.duration);
    }
    position = s.position;
    events.onTime(s.position);
    onLoop(s.loop);
    // Re-assert on every event, not only when our own mirror flips: native is
    // the source of truth here, and anything else that writes the store's
    // playing flag (an error toast, a stale closure) would otherwise leave the
    // bar out of step until the next real flip. The provider ignores repeats.
    if (s.playing) events.onPlay();
    else events.onPause();
  };

  // Old app builds have no overlay methods at all: Capacitor's plugin object
  // only carries the methods the installed APK registered.
  const nativeOverlay = !!p && typeof p.playOverlay === 'function';
  let overlaySeq = 0;
  const overlayEnds = new Map<string, (r: OverlayResult) => void>();
  const settleOverlay = (id: string, r: OverlayResult) => {
    const end = overlayEnds.get(id);
    overlayEnds.delete(id);
    end?.(r);
  };

  if (p) {
    if (nativeOverlay) {
      call(
        p.addListener('overlay', ((d: OverlayEvent) => {
          if (d?.phase !== 'ended') return;
          const reason = OVERLAY_ENDS.includes(d.reason as OverlayEnd) ? (d.reason as OverlayEnd) : 'error';
          const played = Number(d.playedSec);
          settleOverlay(d.id, { reason, playedSec: Number.isFinite(played) ? Math.max(0, played) : 0 });
        }) as (d: never) => void),
      );
    }
    call(p.addListener('state', onState as (d: never) => void));
    call(
      p.addListener('queue', ((d: { tracks: Track[]; index: number }) => {
        index = d.index;
        events.onQueueReplaced?.(d.tracks, d.index);
      }) as (d: never) => void),
    );
    call(p.addListener('ended', (() => events.onEnded()) as (d: never) => void));
    call(
      p.addListener('error', ((d: { message?: string }) => {
        logger.error('audio', d?.message || 'native player error');
        events.onError();
      }) as (d: never) => void),
    );
  }

  /** A page that starts while native already plays (reopened after the car,
   *  or after the app was swiped away while the music went on) must not push
   *  its saved queue over what native is doing: that jumped the music back
   *  to whatever this page last saw. So a paused hand-over (only a page
   *  restoring its saved queue sends one before it has heard from native)
   *  waits until native has said what it has. Native playing something:
   *  this page takes native's queue instead. Native empty (a fresh start):
   *  the saved queue goes over, paused, as before. A tap (play) never waits. */
  type Held = { tracks: Track[]; i: number; origin?: QueueOrigin };
  let settled = !p;
  let held: Held | null = null;
  const send = (h: Held, play: boolean) => {
    if (p) call(p.setQueue({ tracks: h.tracks, index: h.i, play, ...nativeQueueContext(h.origin) }));
  };
  const settle = (s: NativeState | null, q: { tracks: Track[]; index: number } | null) => {
    if (settled) return;
    settled = true;
    const h = held;
    held = null;
    clearTimeout(waitTimer);
    const nativeHas = !!s && s.index >= 0 && !!s.trackId;
    if (h && nativeHas) {
      const same = (a: Track[], b: Track[]) => a.length === b.length && a.every((t, k) => t.id === b[k]?.id);
      if (q && q.tracks.length > 0 && !same(q.tracks, h.tracks)) {
        index = q.index;
        events.onQueueReplaced?.(q.tracks, q.index);
      } else if (!q && h.tracks[s!.index]?.id !== s!.trackId) {
        // An app build that cannot say its queue: the saved one it is.
        send(h, false);
      }
    } else if (h) {
      send(h, false);
    }
    if (s) onState(s);
  };
  const waitTimer = p ? setTimeout(() => settle(null, null), NATIVE_QUEUE_WAIT_MS) : undefined;
  if (p) {
    // Catch up on whatever native is already doing: the UI may have been
    // re-created while the car kept playing.
    void (async () => {
      const s = await p.getState();
      const q = typeof p.getQueue === 'function' ? await p.getQueue().catch(() => null) : null;
      settle(s, q);
    })().catch(() => settle(null, null));
  }

  const overlay: Pick<AudioBackend, 'playOverlay' | 'stopOverlay'> = nativeOverlay
    ? {
        playOverlay(url: string, opts: NativeOverlayOptions): OverlayHandle {
          const id = `o${++overlaySeq}`;
          const finished = new Promise<OverlayResult>((r) => overlayEnds.set(id, r));
          let grace: ReturnType<typeof setTimeout> | undefined;
          void finished.then(() => clearTimeout(grace));
          const started = p!
            .playOverlay!({ id, url, ...opts })
            .then(
              (r) => !!r?.started,
              () => false,
            )
            .then((ok) => {
              if (!ok) settleOverlay(id, { reason: 'error', playedSec: 0 });
              else grace = setTimeout(() => settleOverlay(id, { reason: 'cap', playedSec: opts.maxSec }), opts.maxSec * 1000 + OVERLAY_END_GRACE_MS);
              return ok;
            });
          return { started, finished };
        },
        stopOverlay() {
          call(p!.stopOverlay?.());
        },
      }
    : {};

  return {
    ...overlay,
    // Single-track load is not how this backend works; the provider calls
    // setQueue for queue-owning backends. Kept as a harmless no-op.
    load() {},
    setQueue(tracks, i, play, origin) {
      if (!p) return;
      if (!settled && !play) {
        held = { tracks, i, origin };
        return;
      }
      // Anything the listener did replaces a saved queue still waiting.
      held = null;
      send({ tracks, i, origin }, play);
    },
    play() {
      if (p) call(p.play());
    },
    pause() {
      if (p) call(p.pause());
    },
    stop() {
      if (p) call(p.pause());
    },
    seek(sec) {
      position = Math.max(0, sec);
      if (p) call(p.seek({ sec: position }));
    },
    next() {
      if (p) call(p.next());
    },
    prev() {
      if (p) call(p.prev());
    },
    setLoop(mode) {
      if (!p?.setRepeat) return;
      if (mode === (loopsInFlight[loopsInFlight.length - 1] ?? loop)) return;
      loopsInFlight.push(mode);
      call(p.setRepeat({ mode }));
    },
    setVolume(v) {
      if (p) call(p.setVolume({ v: Math.max(0, Math.min(1, v)) }));
    },
    setNormalize(enabled) {
      if (p?.setNormalize) call(p.setNormalize({ enabled }));
    },
    setMetadata() {
      /* Media3 draws the notification from the queue itself */
    },
    setRemoteCommands() {
      /* the OS talks to the native session directly; nothing to wire here */
    },
    getCurrentTime: () => position,
    getDuration: () => duration,
    isPaused: () => paused,
    isTransitioning: () => false,
    destroy() {
      /* listeners die with the WebView; the native player keeps playing */
    },
  };
};
