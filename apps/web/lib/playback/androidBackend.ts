'use client';

import { logger } from '@/lib/logger/client';
import type { Track } from '@/types/track';
import type { AudioBackendEvents, CreateAudioBackend } from './types';

/** JS surface of the EmberPlayer Capacitor plugin (apps/mobile, Kotlin).
 *  Reached through the bridge Capacitor injects, never imported from npm:
 *  this web app is served by the host, so no plugin JS is ever bundled. */
interface NativeState {
  playing: boolean;
  position: number;
  duration: number;
  index: number;
  trackId: string | null;
}
interface EmberPlayerPlugin {
  addListener(event: string, cb: (data: never) => void): unknown;
  setQueue(o: { tracks: Track[]; index: number; play: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(o: { sec: number }): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  setVolume(o: { v: number }): Promise<void>;
  getState(): Promise<NativeState>;
}

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
  const p = plugin();

  const onState = (s: NativeState) => {
    const wasPaused = paused;
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
    if (wasPaused && s.playing) events.onPlay();
    if (!wasPaused && !s.playing) events.onPause();
  };

  if (p) {
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
    // Catch up on whatever native is already doing: the UI may have been
    // re-created while the car kept playing.
    void p.getState().then(onState).catch(() => {});
  }

  return {
    // Single-track load is not how this backend works; the provider calls
    // setQueue for queue-owning backends. Kept as a harmless no-op.
    load() {},
    setQueue(tracks, i, play) {
      if (!p) return;
      call(p.setQueue({ tracks, index: i, play }));
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
    setVolume(v) {
      if (p) call(p.setVolume({ v: Math.max(0, Math.min(1, v)) }));
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
