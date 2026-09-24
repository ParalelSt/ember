'use client';

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger/client';
import type { Track } from '@/types/track';
import type { AudioBackend, CreateAudioBackend, RemoteCommands } from './types';

/** What `tauriCacheAdapter.localSrcFor` hands the provider for a song in the
 *  desktop auto cache: `cache:<track id>`. Not a URL the engine fetches; it
 *  tells the engine to open its cached file (and, should that file be
 *  unreadable, to stream from the URL it was cached from). */
export const TAURI_CACHE_PREFIX = 'cache:';

/** Resolve a possibly-relative stream URL (e.g. "/api/youtube/stream/<id>") to an
 *  absolute URL against the webview's origin (the host the shell loaded), because
 *  the Rust engine — outside the webview — needs an absolute URL to stream. */
export function toAbsolute(url: string): string {
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

/** Just the pb_auth cookie, not the whole jar: the engine has no business
 *  with anything else the page has set. */
export function sessionCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = /(?:^|;\s*)pb_auth=([^;]*)/.exec(document.cookie);
  return m ? `pb_auth=${m[1]}` : null;
}

export const createTauriBackend: CreateAudioBackend = (events) => {
  // Local mirrors so the synchronous getters can answer without an IPC round-trip.
  let curTime = 0;
  let duration = 0;
  let paused = true;
  let transitioning = false;
  let transitionTimer: ReturnType<typeof setTimeout> | null = null;
  let cmds: RemoteCommands | null = null;
  const unlisteners: UnlistenFn[] = [];

  const armTransition = () => {
    transitioning = true;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => { transitioning = false; }, 8000);
  };

  // Wire Rust → events. listen() is async; we push unlisteners as they resolve.
  const sub = <T,>(name: string, fn: (p: T) => void) => {
    listen<T>(name, (e) => fn(e.payload)).then((u) => unlisteners.push(u)).catch(() => {});
  };
  sub<{ sec: number }>('audio:time', ({ sec }) => {
    curTime = sec;
    transitioning = false;
    events.onTime(sec);
  });
  sub<{ sec: number }>('audio:duration', ({ sec }) => { duration = sec; events.onDuration(sec); });
  sub<Record<string, never>>('audio:ended', () => events.onEnded());
  sub<Record<string, never>>('audio:play', () => { paused = false; events.onPlay(); });
  sub<Record<string, never>>('audio:pause', () => { paused = true; events.onPause(); });
  // `retry` is the engine's own verdict on whether web audio could do better:
  // 'none' means the host could not deliver the song at all, so swapping
  // engines only asks the same server the same question. Anything else (an
  // older engine sends no field at all) keeps the old "try web audio" answer.
  sub<{ message: string; retry?: string }>('audio:error', ({ message, retry }) => {
    logger.error('audio', message || 'native audio error');
    curTime = 0;
    // Nothing is playing now. Left at "playing", the provider's toggle sent
    // pause for every press of play; the engine answers play after a failed
    // load by trying the song again.
    paused = true;
    events.onError({ canRetryOnWebAudio: retry !== 'none' });
  });
  sub<{ kind: string; sec?: number }>('audio:cmd', ({ kind, sec }) => {
    if (!cmds) return;
    if (kind === 'play') cmds.play();
    else if (kind === 'pause') cmds.pause();
    // OS toggle button (e.g. headphone/media key): resolve here from the local
    // paused mirror, since RemoteCommands has no dedicated toggle.
    else if (kind === 'toggle') { if (paused) cmds.play(); else cmds.pause(); }
    else if (kind === 'next') cmds.next();
    else if (kind === 'prev') cmds.prev();
    else if (kind === 'seek' && typeof sec === 'number') cmds.seek(sec);
  });

  const backend: AudioBackend = {
    load(url, opts) {
      armTransition();
      duration = 0;
      curTime = opts.startAt ?? 0;
      paused = !opts.autoplay;
      // A cached song arrives either as `opts.cacheKey` beside its stream URL
      // or as the `cache:<id>` stand-in; either way the engine gets the id.
      const fromCache = url.startsWith(TAURI_CACHE_PREFIX);
      const cacheKey = opts.cacheKey ?? (fromCache ? url.slice(TAURI_CACHE_PREFIX.length) : undefined);
      void invoke('audio_load', {
        url: fromCache ? url : toAbsolute(url),
        // An older desktop build ignores the extra argument and streams.
        cacheKey: cacheKey ?? null,
        autoplay: opts.autoplay,
        startAt: opts.startAt ?? 0,
        // The Rust engine fetches over plain HTTP with no browser session, so
        // authenticated routes 401 there. /api/youtube/stream/... is public,
        // but member uploads are not — without this an uploaded song fails on
        // desktop while playing fine in a browser. Only pb_auth is forwarded.
        cookie: sessionCookie(),
        // A rejection here means the COMMAND could not run at all (the
        // capability denied it, no output device): the engine is the problem,
        // not the song, so web audio is exactly the right answer. Failures the
        // engine itself saw come through `audio:error` instead, with their own
        // verdict, and do not reject.
      }).catch(() => events.onError({ canRetryOnWebAudio: true }));
    },
    play() { paused = false; void invoke('audio_play').catch(() => {}); },
    pause() { paused = true; void invoke('audio_pause').catch(() => {}); },
    stop() { void invoke('audio_stop').catch(() => {}); },
    seek(sec) {
      const target = Math.max(0, Math.min(sec, duration || sec));
      if (Math.abs(target - curTime) > 2.5) {
        logger.breadcrumb('playback', 'seek jump', { from: curTime, to: target });
      }
      curTime = target;
      void invoke('audio_seek', { sec: target }).catch(() => {});
      events.onTime(target); // optimistic, mirrors web backend
    },
    setVolume(v, opts) {
      // Same curve as the web backend: party (gain>1) = linear + amplify, else pow 1.5.
      const gain = opts?.gain ?? 1;
      const amplitude = gain > 1 ? Math.min(1, v) * gain : Math.pow(v, 1.5);
      void invoke('audio_set_volume', { amplitude }).catch(() => {});
    },
    setMetadata(track: Track | null) {
      void invoke('audio_set_metadata', {
        title: track?.title ?? '',
        artist: track?.artist ?? '',
        album: track?.album ?? '',
        artworkUrl: track?.artworkUrl ? toAbsolute(track.artworkUrl) : '',
      }).catch(() => {});
    },
    setRemoteCommands(c) { cmds = c; },
    getCurrentTime: () => curTime,
    getDuration: () => duration,
    isPaused: () => paused,
    isTransitioning: () => transitioning,
    destroy() {
      if (transitionTimer) clearTimeout(transitionTimer);
      void invoke('audio_stop').catch(() => {});
      for (const u of unlisteners) { try { u(); } catch { /* noop */ } }
    },
  };
  return backend;
};
