'use client';

import { logger } from '@/lib/logger/client';
import { autoPreampDb, DEFAULT_EQ, EQ_BANDS, EQ_PEAK_Q, eqActive, type EqSettings } from './eq';
import { createGainRamp } from './gainRamp';
import type { AudioBackend, CreateAudioBackend, RemoteCommands } from './types';

/** HTMLMediaElement.NETWORK_LOADING, spelled out: some DOMs (and test
 *  environments) do not expose the constant on the class. */
const NETWORK_LOADING = 2;

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

  // --- Web Audio graph: the equalizer and party mode's gain > 1.0. Built on
  // demand only, the first time either is switched on: calling
  // createMediaElementSource() permanently re-routes the element, which on
  // phones can cost native MediaSession + background playback (a context the
  // OS suspends with the screen off takes the music with it). So normal
  // playback stays on the bare element, the equalizer is off by default and
  // Settings warns about it on a phone browser. Once built, the graph stays
  // until the page reloads: switched off, the filters sit at 0 dB and the
  // pre-amp at 1, which is the bare element's sound.
  //
  //   element -> 60 Hz low shelf -> 230 / 910 / 3.6k peaking -> 14k high shelf
  //           -> eq pre-amp (auto headroom) -> party gain -> speakers
  //
  // Normalization rides on the party gain node when the graph exists (it can
  // lift a quiet song past the element's 1.0); on the bare element it is part
  // of the element's volume, which cannot go past 1.0.
  let audioCtx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let eqFilters: BiquadFilterNode[] = [];
  let eqPre: GainNode | null = null;
  let eq: EqSettings = DEFAULT_EQ;
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
      const filters = EQ_BANDS.map((freq, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        f.frequency.value = freq;
        f.Q.value = EQ_PEAK_Q;
        f.gain.value = 0;
        return f;
      });
      const pre = ctx.createGain();
      const gain = ctx.createGain();
      let node: AudioNode = source;
      for (const f of filters) {
        node.connect(f);
        node = f;
      }
      node.connect(pre);
      pre.connect(gain);
      gain.connect(ctx.destination);
      audioCtx = ctx;
      // Once the graph exists the element plays into it, so the output
      // device is the context's, not the element's (see setOutputDevice).
      if (sinkId) void applyContextSink(ctx, sinkId);
      eqFilters = filters;
      eqPre = pre;
      gainNode = gain;
      applyEq();
      return gain;
    } catch (e) {
      logger.error('audio', 'web audio init failed', undefined, e as Error);
      return null;
    }
  };
  // --- Output device (lib/outputs): '' is the system default. The element
  // and, once the graph exists, the audio context both take it: with the
  // graph built, the element's own sink no longer decides where it sounds.
  let sinkId = '';
  const applyContextSink = (ctx: AudioContext, id: string): Promise<void> => {
    const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof withSink.setSinkId !== 'function') return Promise.resolve();
    return withSink.setSinkId(id).catch((e: unknown) => {
      logger.error('audio', 'audio context would not change output', undefined, e as Error);
    });
  };
  /** Puts the current settings on the graph, if there is one. */
  const applyEq = () => {
    if (!eqPre || !audioCtx) return;
    const on = eqActive(eq);
    eqFilters.forEach((f, i) => {
      f.gain.value = on ? eq.bands[i] ?? 0 : 0;
    });
    eqPre.gain.value = on ? Math.pow(10, autoPreampDb(eq.bands, audioCtx.sampleRate || 48000) / 20) : 1;
  };

  // --- Volume: the slider value (0..1, muted and ducked by the caller),
  // party mode's gain, and the song's normalization gain, which fades
  // (gainRamp) when it changes in the middle of a song.
  let level = 1;
  let partyGain = 1;
  /** Nothing is touched before the first setVolume. */
  let volumeSet = false;
  const applyVolume = () => {
    if (!volumeSet) return;
    const n = norm.value();
    if (partyGain > 1) {
      // Party: linear (slider drives output 1:1 up to 1.0), then the graph
      // amplifies, normalization included.
      const g = ensureGraph();
      if (g) {
        a.volume = Math.min(1, level);
        audioCtx?.resume?.().catch(() => {});
        g.gain.value = partyGain * n;
      } else {
        a.volume = Math.min(1, level * n);
      }
      return;
    }
    // Normal: power 1.5. With a graph already built (the equalizer), the
    // song's gain goes on the graph, so a quiet song really comes up (its
    // boost is held under its true peak by the server: nothing clips). The
    // bare element cannot go past 1.0, so there a boost only uses the room
    // the slider leaves. The graph is never built just for this: on phones
    // it can cost background playback.
    const curved = Math.pow(Math.max(0, level), 1.5);
    if (gainNode) {
      a.volume = Math.min(1, curved);
      gainNode.gain.value = n;
    } else {
      a.volume = Math.min(1, curved * n);
    }
  };
  const norm = createGainRamp(() => applyVolume());

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
  /** Where pendingMeta will put the playhead. */
  let pendingTarget = 0;
  const restoreOnMeta = (restoreTo: number) => {
    if (pendingMeta) a.removeEventListener('loadedmetadata', pendingMeta);
    pendingTarget = restoreTo;
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
  // --- Lock-screen / remote transport. WebKit (the iPhone app's WKWebView,
  // Safari) only tells the OS about the page's action handlers when they are
  // set while the element is playing: handlers registered before the first
  // play leave the lock screen on its defaults, which are -15 s / +15 s skip
  // buttons instead of previous / next (checked on the iOS 26 simulator:
  // mediaremoted gets NextTrack and PreviousTrack only after a 'playing'
  // re-registration). So the commands are kept and put back on every
  // 'playing'; other browsers take the same calls as a no-op.
  let remote: RemoteCommands | null = null;
  const applyRemoteCommands = () => {
    if (!remote || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const cmds = remote;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => cmds.play()],
      ['pause', () => cmds.pause()],
      ['previoustrack', () => cmds.prev()],
      ['nexttrack', () => cmds.next()],
      ['seekto', (e) => {
        if (typeof e.seekTime !== 'number') return;
        // The lock screen's scrubber belongs to the song it was showing. A
        // seek that arrives while the next song is still loading was meant
        // for the one before: iOS sends a second one when a scrub to the end
        // lets go, and it landed on the new song and skipped it too.
        if (transitioning) {
          logger.breadcrumb('playback', 'remote seek dropped: a new song is loading', { to: e.seekTime });
          return;
        }
        cmds.seek(e.seekTime);
      }],
    ];
    for (const [action, handler] of handlers) {
      // An engine that does not know one action throws for it; the others
      // must still be set.
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    }
  };
  const onPlaying = () => applyRemoteCommands();

  a.addEventListener('error', onError);
  a.addEventListener('playing', onPlaying);
  a.addEventListener('timeupdate', onTime);
  a.addEventListener('loadedmetadata', onLoadedMeta);
  a.addEventListener('ended', onEnded);
  a.addEventListener('play', onPlay);
  a.addEventListener('pause', onPause);

  const backend: AudioBackend = {
    load(url, opts) {
      armTransition();
      lastUrl = url;
      // The playhead is this song's from here on: the previous song's last
      // report must not be where a rebuild (play() below) resumes it.
      lastKnownTime = opts.startAt ?? 0;
      // Setting .src queues a load; no explicit a.load() (it forces a harder
      // reset that tears the notification down on a track advance).
      a.src = url;
      restoreOnMeta(opts.startAt ?? 0);
      if (opts.autoplay) {
        audioCtx?.resume?.().catch(() => {});
        // AbortError means a newer load replaced this one, not that playback
        // stopped: reporting it as a pause flickered the notification.
        a.play().then(() => events.onPlay()).catch((e: unknown) => {
          if ((e as { name?: string } | null)?.name !== 'AbortError') events.onPause();
        });
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
      // last URL and resume from the last known position. A load whose
      // metadata has not arrived yet has not reported a playhead at all: it
      // resumes where that load was going to start (a cold start's saved
      // position), not at 0.
      if (!lastUrl) return;
      const resumeAt = pendingMeta ? pendingTarget : lastKnownTime;
      armTransition();
      a.src = lastUrl;
      restoreOnMeta(resumeAt);
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
      // Clamp only to a length the element actually knows: right after a load
      // it is NaN, and clamping to "0" sent every early seek to 0:00.
      const len = a.duration;
      const target = Math.max(0, Number.isFinite(len) && len > 0 ? Math.min(sec, len) : sec);
      const from = a.currentTime || 0;
      // A tap on the progress bar/remote command is a "jump"; the ~4 Hz
      // timeupdate-driven onTime() calls above are not seeks at all, so
      // this is the only place seek breadcrumbs come from. Small
      // corrections (scrubbing pixel-by-pixel) are noise below 2.5 s.
      if (Math.abs(target - from) > 2.5) {
        logger.breadcrumb('playback', 'seek jump', { from, to: target });
      }
      a.currentTime = target;
      lastKnownTime = target;
      // Optimistically surface the target so the thumb stays where the user
      // dropped it instead of snapping back until the next timeupdate.
      events.onTime(target);
    },

    setVolume(v, opts) {
      volumeSet = true;
      level = v;
      partyGain = opts?.gain ?? 1;
      norm.set(opts?.normGain ?? 1, opts?.rampMs ?? 0);
      applyVolume();
    },

    setEq(next) {
      eq = next;
      // Nothing to build for an equalizer that changes nothing: a phone that
      // never switches it on keeps the bare element.
      if (eqActive(next) && ensureGraph()) audioCtx?.resume?.().catch(() => {});
      applyEq();
      // A graph built just now takes the song's gain over from the element.
      applyVolume();
    },

    setMetadata(track, localArtSrc) {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
      if (!track) {
        navigator.mediaSession.metadata = null;
        return;
      }
      const art = localArtSrc ?? track.artworkUrl;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
        artwork: art ? [{ src: art, sizes: '512x512' }] : [],
      });
    },

    setRemoteCommands(cmds) {
      remote = cmds;
      applyRemoteCommands();
    },

    getBufferedToEnd() {
      if (!a.src) return null;
      // A local copy (a pinned or auto-cached blob) is all on this device.
      if (a.src.startsWith('blob:')) return true;
      const dur = a.duration;
      if (!Number.isFinite(dur) || dur <= 0) return null;
      const b = a.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= (a.currentTime || 0) + 0.5 && b.end(i) >= dur - 0.5) return true;
      }
      // Still fetching: a prefetch now would compete with it. Not fetching
      // but not complete either means the browser chose to stop buffering
      // (it caps how far ahead it reads), which it may never resume: that is
      // "cannot tell", and the policy falls back to play time.
      return a.networkState === NETWORK_LOADING ? false : null;
    },

    setRate(rate) {
      const r = Number.isFinite(rate) && rate > 0 ? Math.min(4, Math.max(0.25, rate)) : 1;
      // Pitch kept, in every engine's spelling. The default rate too: a new
      // src resets playbackRate to it.
      const el = a as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
      el.preservesPitch = true;
      el.webkitPreservesPitch = true;
      el.mozPreservesPitch = true;
      a.defaultPlaybackRate = r;
      a.playbackRate = r;
    },

    async setOutputDevice(deviceId) {
      const el = a as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof el.setSinkId !== 'function') throw new Error('this browser cannot pick an output device');
      // The element first: it is what refuses a device the page may not use,
      // and nothing is changed then.
      await el.setSinkId(deviceId);
      sinkId = deviceId;
      if (audioCtx) await applyContextSink(audioCtx, deviceId);
    },

    outputDevice: () => sinkId,

    getCurrentTime: () => a.currentTime || 0,
    getDuration: () => a.duration || 0,
    isPaused: () => a.paused,
    isTransitioning: () => transitioning,
    mediaElement: () => a,

    destroy() {
      if (transitionTimer) clearTimeout(transitionTimer);
      norm.cancel();
      remote = null;
      a.removeEventListener('error', onError);
      a.removeEventListener('playing', onPlaying);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoadedMeta);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        (['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as const).forEach((act) => {
          try {
            navigator.mediaSession.setActionHandler(act, null);
          } catch {
            /* unsupported action, never set */
          }
        });
      }
      a.pause();
      a.removeAttribute('src');
      a.remove();
      audioCtx?.close?.().catch(() => {});
    },
  };

  return backend;
};
