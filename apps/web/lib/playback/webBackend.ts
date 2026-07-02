'use client';

import { logger } from '@/lib/logger/client';
import type { AudioBackend, CreateAudioBackend } from './types';

export const createWebBackend: CreateAudioBackend = (events) => {
  // --- Audio element (DOM-attached; Firefox Android only surfaces lock-screen
  // controls for a media element it can see in the document). preload='auto' so
  // the browser buffers ahead of the playhead — survives background throttling.
  const a = new Audio();
  a.preload = 'auto';
  a.setAttribute('aria-hidden', 'true');
  a.style.position = 'fixed';
  a.style.width = '1px';
  a.style.height = '1px';
  a.style.opacity = '0';
  a.style.pointerEvents = 'none';
  if (typeof document !== 'undefined') document.body.appendChild(a);

  // --- Web Audio gain graph (party mode > 1.0). Built on demand only — calling
  // createMediaElementSource() permanently re-routes the element, which breaks
  // native MediaSession + background playback, so normal playback stays on the
  // bare element. Desktop party mode only; phones never build it.
  let audioCtx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  const ensureGraph = (): GainNode | null => {
    if (gainNode) return gainNode;
    if (typeof window === 'undefined') return null;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(a);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      audioCtx = ctx;
      gainNode = gain;
      return gain;
    } catch (e) {
      logger.error('audio', 'web audio init failed', undefined, e as Error);
      return null;
    }
  };

  // --- Transition + recovery state.
  let transitioning = false;
  let lastUrl = '';
  let lastKnownTime = 0;
  let transitionTimer: ReturnType<typeof setTimeout> | null = null;

  const armTransition = () => {
    transitioning = true;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      transitioning = false;
    }, 8000);
  };

  // restoreTo handling shared by load() and play()-recovery: jump to the saved
  // position once metadata is known, then surface it via onTime so the provider
  // updates position + its last-valid fallback.
  // pendingMeta: the not-yet-fired handler from the CURRENT load. Removed
  // before the next load registers its own — otherwise a stale restoreTo fires
  // on the new track's loadedmetadata and seeks it to the previous song's
  // position (same leak fixed in the pre-seam provider on test-branch).
  let pendingMeta: (() => void) | null = null;
  const restoreOnMeta = (restoreTo: number) => {
    if (pendingMeta) a.removeEventListener('loadedmetadata', pendingMeta);
    const onMetaOnce = () => {
      pendingMeta = null;
      if (restoreTo > 1 && restoreTo < (a.duration || Infinity)) {
        a.currentTime = restoreTo;
        lastKnownTime = restoreTo;
        events.onTime(restoreTo);
      }
      transitioning = false;
    };
    pendingMeta = onMetaOnce;
    a.addEventListener('loadedmetadata', onMetaOnce, { once: true });
  };

  // --- Element events → provider callbacks. Firefox Android only renders the
  // media widget when mediaSession.playbackState is explicitly set; drive it
  // from the element's own play/pause events (safe on the bare element path).
  const setMediaState = (s: MediaSessionPlaybackState) => {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = s;
    }
  };
  const onError = () => {
    const code = a.error?.code;
    const message = a.error?.message ?? 'audio element error';
    logger.error('audio', message, { code, src: a.src });
    // Drop the dead src so the prior position doesn't stick on screen.
    a.removeAttribute('src');
    events.onError();
  };
  const onTime = () => {
    const pos = a.currentTime || 0;
    lastKnownTime = pos;
    events.onTime(pos);
  };
  const onLoadedMeta = () => events.onDuration(a.duration || 0);
  const onEnded = () => events.onEnded();
  const onPlay = () => {
    events.onPlay();
    setMediaState('playing');
  };
  const onPause = () => {
    events.onPause();
    setMediaState('paused');
  };
  a.addEventListener('error', onError);
  a.addEventListener('timeupdate', onTime);
  a.addEventListener('loadedmetadata', onLoadedMeta);
  a.addEventListener('ended', onEnded);
  a.addEventListener('play', onPlay);
  a.addEventListener('pause', onPause);

  const backend: AudioBackend = {
    load(url, opts) {
      armTransition();
      lastUrl = url;
      // Setting .src queues a load; no explicit a.load() (it forces a harder
      // reset that tears the notification down on a track advance).
      a.src = url;
      restoreOnMeta(opts.startAt ?? 0);
      if (opts.autoplay) {
        audioCtx?.resume?.().catch(() => {});
        a.play().then(() => events.onPlay()).catch(() => events.onPause());
      }
    },

    play() {
      // A MediaSession action / click counts as a user gesture, so resume() is
      // allowed here. Wake the graph in case it suspended in the background.
      audioCtx?.resume?.().catch(() => {});
      if (a.src && !a.error && a.readyState >= 2) {
        a.play().then(() => events.onPlay()).catch(() => {});
        return;
      }
      // Suspended / errored: the error handler dropped the src. Rebuild from the
      // last URL and resume from the last known position.
      if (!lastUrl) return;
      armTransition();
      a.src = lastUrl;
      restoreOnMeta(lastKnownTime);
      a.play().then(() => events.onPlay()).catch(() => {});
    },

    pause() {
      a.pause();
    },

    stop() {
      a.pause();
      a.removeAttribute('src');
      lastUrl = '';
    },

    seek(sec) {
      const target = Math.max(0, Math.min(sec, a.duration || 0));
      a.currentTime = target;
      lastKnownTime = target;
      // Optimistically surface the target so the thumb stays where the user
      // dropped it instead of snapping back until the next timeupdate.
      events.onTime(target);
    },

    setVolume(v, opts) {
      const gain = opts?.gain ?? 1;
      const party = gain > 1;
      // Party: linear (slider drives output 1:1 up to 1.0). Normal: power 1.5.
      a.volume = party ? Math.min(1, v) : Math.pow(v, 1.5);
      if (party) {
        const g = ensureGraph();
        if (g) {
          audioCtx?.resume?.().catch(() => {});
          g.gain.value = gain;
        }
      } else if (gainNode) {
        gainNode.gain.value = 1;
      }
    },

    setMetadata(track) {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
      if (!track) {
        navigator.mediaSession.metadata = null;
        return;
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
        artwork: track.artworkUrl ? [{ src: track.artworkUrl, sizes: '512x512' }] : [],
      });
    },

    setRemoteCommands(cmds) {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
      navigator.mediaSession.setActionHandler('play', cmds.play);
      navigator.mediaSession.setActionHandler('pause', cmds.pause);
      navigator.mediaSession.setActionHandler('previoustrack', cmds.prev);
      navigator.mediaSession.setActionHandler('nexttrack', cmds.next);
      navigator.mediaSession.setActionHandler('seekto', (e) => {
        if (typeof e.seekTime === 'number') cmds.seek(e.seekTime);
      });
    },

    getCurrentTime: () => a.currentTime || 0,
    getDuration: () => a.duration || 0,
    isPaused: () => a.paused,
    isTransitioning: () => transitioning,

    destroy() {
      if (transitionTimer) clearTimeout(transitionTimer);
      a.removeEventListener('error', onError);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoadedMeta);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        (['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as const).forEach((act) =>
          navigator.mediaSession.setActionHandler(act, null),
        );
      }
      a.pause();
      a.removeAttribute('src');
      a.remove();
      audioCtx?.close?.().catch(() => {});
    },
  };

  return backend;
};
