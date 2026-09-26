'use client';

import { logger } from '@/lib/logger/client';
import type { Track } from '@/types/track';
import type { AudioBackend, AudioBackendEvents, LoadOptions } from './types';

/** One song as a cast device gets it: a URL the device can fetch by itself
 *  (signed, on the host's public origin: lib/cast/signer) and what the TV
 *  shows while it plays. */
export interface CastMedia {
  url: string;
  contentType: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
}

/** What the receiver reports. `idleReason` only means something when
 *  `state` is idle: `finished` is the song's real end. */
export interface CastRemoteStatus {
  state: 'idle' | 'buffering' | 'playing' | 'paused';
  time: number;
  duration: number;
  idleReason: 'finished' | 'error' | 'interrupted' | 'cancelled' | null;
  /** The URL the receiver has loaded, when it has one (a signed stream). */
  contentId?: string | null;
}

/** A cast session as the backend drives it. The Google Cast adapter
 *  (lib/cast/googleCast) is the real one; tests pass a fake. */
export interface CastRemote {
  load(media: CastMedia, opts: { startAt: number; autoplay: boolean }): Promise<void>;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  stop(): void;
  /** 0..1, the device's own volume. */
  setVolume(v: number): void;
  status(): CastRemoteStatus;
  subscribe(cb: (s: CastRemoteStatus) => void): () => void;
}

/** A backend that plays on a cast device. It takes the TRACK, not a URL:
 *  the page's URLs (a blob: of a cached copy, a relative stream path that
 *  needs the cookie) mean nothing to a TV, so it signs its own. */
export interface CastBackend extends AudioBackend {
  loadTrack(track: Track, opts: LoadOptions): void;
}

/** Plays on a Chromecast / Google speaker / Android TV through [remote].
 *  The provider still owns the queue: the receiver gets one song at a time,
 *  and its "finished" is this backend's `ended`, so next, loop and radio work
 *  exactly as they do on the phone or the computer.
 *
 *  No equalizer and no volume normalization here: the default receiver
 *  plays the file as it is. The volume slider sets the device's volume. */
export function createCastBackend(
  events: AudioBackendEvents,
  remote: CastRemote,
  resolveMedia: (track: Track) => Promise<CastMedia>,
): CastBackend {
  let seq = 0;
  /** A load in flight: the receiver's idle ("interrupted") and buffering
   *  states in between are the old song leaving, not news. */
  let loading = false;
  let time = 0;
  let duration = 0;
  let paused = true;
  /** The load whose end was already reported, so a finished song is one
   *  `ended`, however many status updates repeat it. */
  let endedSeq = -1;
  /** Whether this load has been heard playing: only then is an idle
   *  "finished" its real end. */
  let started = false;

  const onStatus = (s: CastRemoteStatus) => {
    if (loading) return;
    if (Number.isFinite(s.duration) && s.duration > 0 && s.duration !== duration) {
      duration = s.duration;
      events.onDuration(duration);
    }
    if (Number.isFinite(s.time) && s.time >= 0 && s.state !== 'idle' && s.time !== time) {
      time = s.time;
      events.onTime(time);
    }
    if (s.state === 'playing') {
      started = true;
      paused = false;
      events.onPlay();
    } else if (s.state === 'paused') {
      paused = true;
      events.onPause();
    } else if (s.state === 'idle') {
      if (s.idleReason === 'finished' && started && endedSeq !== seq) {
        endedSeq = seq;
        paused = true;
        events.onEnded();
      } else if (s.idleReason === 'error' && endedSeq !== seq) {
        endedSeq = seq;
        paused = true;
        logger.error('cast', 'the cast device could not play the song');
        // The device could not play what the host sent: web audio would ask
        // the same host, so this is not an engine fault.
        events.onError({ canRetryOnWebAudio: false });
      }
    }
  };
  const unsubscribe = remote.subscribe(onStatus);

  const backend: CastBackend = {
    loadTrack(track, opts) {
      const mine = ++seq;
      loading = true;
      started = false;
      time = Math.max(0, opts.startAt ?? 0);
      paused = !opts.autoplay;
      events.onTime(time);
      void resolveMedia(track)
        .then((media) => (mine === seq ? remote.load(media, { startAt: time, autoplay: opts.autoplay }) : undefined))
        .then(() => {
          if (mine !== seq) return;
          loading = false;
          onStatus(remote.status());
        })
        .catch((e: unknown) => {
          if (mine !== seq) return;
          loading = false;
          paused = true;
          logger.error('cast', 'could not start the song on the cast device', { trackId: track.id }, e as Error);
          events.onError({ canRetryOnWebAudio: false });
        });
    },
    // The provider hands cast engines the track (loadTrack); a URL alone
    // could not be played by the device.
    load() {},
    play() {
      paused = false;
      remote.play();
    },
    pause() {
      paused = true;
      remote.pause();
    },
    stop() {
      paused = true;
      remote.stop();
    },
    seek(sec) {
      time = Math.max(0, sec);
      remote.seek(time);
      events.onTime(time);
    },
    setVolume(v) {
      remote.setVolume(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)));
    },
    setMetadata() {
      /* the TV shows what came with the song (CastMedia) */
    },
    setRemoteCommands() {
      /* the page's media keys still reach the provider through the local engine's session */
    },
    getCurrentTime: () => time,
    getDuration: () => duration,
    isPaused: () => paused,
    getBufferedToEnd: () => null,
    isTransitioning: () => loading,
    destroy() {
      seq++;
      unsubscribe();
    },
  };
  return backend;
}

/** True for an engine that plays somewhere else and needs the track itself. */
export function isCastBackend(b: AudioBackend | null | undefined): b is CastBackend {
  return !!b && typeof (b as Partial<CastBackend>).loadTrack === 'function';
}
