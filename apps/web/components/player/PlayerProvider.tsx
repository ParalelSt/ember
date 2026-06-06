'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteRecordPlay, useQueryHistory, useQueryLikes } from '@/hooks/useLibrary';
import { api, apiUrl } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { songKey } from '@/lib/songKey';
import type { PlaybackContext, Track } from '@/types/track';

interface PlayerControls {
  current: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  queue: Track[];
  index: number;
  context: PlaybackContext | null;
  playTrack: (track: Track, list?: Track[], context?: PlaybackContext | null) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
}

const PlayerContext = createContext<PlayerControls | null>(null);

/** Player provider — owns the singleton <audio> element and orchestrates
 *  playback, persistence-on-write merges, radio mode, Discord, media session.
 *  The audio element is ref-held (it needs imperative mutation: currentTime,
 *  src, etc.); `audioReady` is a state flag so dependent effects re-run once
 *  the element is constructed on first client render. */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const context = usePlayerStore((s) => s.context);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setIndex = usePlayerStore((s) => s.setIndex);
  const setPosition = usePlayerStore((s) => s.setPosition);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setStoreVolume = usePlayerStore((s) => s.setVolume);
  const setContext = usePlayerStore((s) => s.setContext);

  const { user } = useAuth();
  const { data: history = [] } = useQueryHistory();
  const { data: liked = [] } = useQueryLikes();
  const recordPlay = useExecuteRecordPlay();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  const userInteracted = useRef(false);
  // null = "uninitialized, fall back to the persisted store value on read."
  // We can't seed this from `position` directly because zustand-persist
  // rehydration completes AFTER the first React render, so useRef would
  // freeze it at 0 even when the store ends up holding 2:57. Reading from
  // the store inside loadAndPlay defers that lookup until effects run, by
  // which point rehydration is guaranteed to be done.
  const wantPosition = useRef<number | null>(null);
  const isTransitioning = useRef(false);
  const lastValidPosition = useRef(position);
  const lastPosWrite = useRef(0);
  const fetchingRadioFor = useRef<string | null>(null);

  useEffect(() => {
    if (audioRef.current) return;
    const a = new Audio();
    a.preload = 'metadata';
    a.addEventListener('error', () => {
      const code = a.error?.code;
      const message = a.error?.message ?? 'audio element error';
      logger.error('audio', message, { code, src: a.src });
    });
    audioRef.current = a;
    setAudioReady(true);
  }, []);

  const current = queue[index] ?? null;

  // Web Audio gain — wraps the <audio> element so we can amplify above
  // its 1.0 ceiling in party mode. audio.volume alone caps at 1.0; an
  // AudioContext + GainNode lets us push 2× through for actual louder.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const partyVolume = useSettingsStore((s) => s.partyVolume);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    // Lazily wire up the Web Audio graph on the first effect run after
    // the audio element exists. Doing it once and only once — repeated
    // createMediaElementSource() calls on the same element throw.
    if (typeof window !== 'undefined' && !audioCtxRef.current) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        try {
          const ctx = new Ctor();
          const source = ctx.createMediaElementSource(a);
          const gain = ctx.createGain();
          source.connect(gain);
          gain.connect(ctx.destination);
          audioCtxRef.current = ctx;
          gainNodeRef.current = gain;
        } catch (e) {
          // Safari/iOS sometimes throws if the context is constructed
          // outside a user gesture — fall back to bare a.volume only.
          logger.error('audio', 'web audio init failed', undefined, e as Error);
        }
      }
    }

    // Default curve: power 1.5 — between the old square curve (which
    // spiked at the top) and pure linear (too loud at halfway). Halfway
    // slider ≈ 0.28 audio, top ≈ 0.78.
    // Party mode: linear with no cap — slider directly drives audio
    // output 1:1 up to 1.0 for loud-as-it-goes playback.
    a.volume = partyVolume ? Math.min(1, volume) : Math.pow(volume, 1.5);

    // Gain boost ONLY in party mode — 2× pre-clipping headroom on top of
    // the audio element's own 1.0 ceiling. Off mode leaves it at 1.0
    // (passthrough) so the curve above is the only attenuation.
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = partyVolume ? 2 : 1;
    }
  }, [audioReady, volume, partyVolume]);

  // When party mode turns OFF, the stored volume may sit above the
  // normal 0.85 cap (party allowed up to 1.0). Without this clamp the
  // slider's max prop drops to 85, the value stays at e.g. 95, and the
  // thumb gets stuck at the right edge while audio keeps playing at
  // the higher level. Snap volume back into the normal range so the
  // slider position and audio level both honour party=off immediately.
  useEffect(() => {
    if (!partyVolume && volume > 0.85) {
      setStoreVolume(0.85);
    }
  }, [partyVolume, volume, setStoreVolume]);

  // Synchronously load + play the given track on the audio element. Must be
  // called from a user-gesture handler (click, keypress) — React 19 effects
  // run asynchronously, so audio.play() inside a useEffect loses the user
  // activation flag and gets silently rejected by the browser's autoplay
  // policy. Anything that initiates playback (playTrack, next, prev) calls
  // this directly from the click handler, then schedules state updates.
  const loadAndPlay = useCallback((track: Track | null, autoplay: boolean) => {
    const a = audioRef.current;
    if (!a) return;
    if (!track) {
      a.pause();
      a.removeAttribute('src');
      return;
    }
    isTransitioning.current = true;
    a.src = apiUrl(track.streamUrl);
    a.load();
    // First call after mount: wantPosition is still null, so honor the
    // persisted position from the store (which has finished rehydrating
    // by the time this effect-driven call fires). Subsequent calls
    // (next/prev) reset wantPosition to 0 below so new tracks start fresh.
    const restoreTo = wantPosition.current ?? usePlayerStore.getState().position;
    wantPosition.current = 0;
    const onMeta = () => {
      if (restoreTo > 1 && restoreTo < (a.duration || Infinity)) {
        a.currentTime = restoreTo;
        setPosition(restoreTo);
        lastValidPosition.current = restoreTo;
      }
      isTransitioning.current = false;
    };
    a.addEventListener('loadedmetadata', onMeta, { once: true });
    setTimeout(() => { isTransitioning.current = false; }, 8000);
    if (autoplay) {
      // Wake the AudioContext if it's suspended — Safari / iOS / new
      // Chrome require a user gesture to start the graph, and loadAndPlay
      // only fires from click/keypress handlers. Without this, party-mode
      // gain produces silence even though the audio element runs.
      audioCtxRef.current?.resume?.().catch(() => {});
      a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }, [setPosition, setIsPlaying]);

  // Drives src+autoplay on track changes that originate outside playTrack —
  // notably the auto-advance when a track ends (onEnd → next() → index change),
  // and the initial hydration of a persisted queue on cold load.
  useEffect(() => {
    if (!audioReady) return;
    loadAndPlay(current, userInteracted.current);
    if (current && userInteracted.current && user) recordPlay.mutate(current);
    if (!current) {
      setIsPlaying(false);
      setPosition(0);
      setDuration(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioReady, current?.id]);

  const next = useCallback(() => {
    userInteracted.current = true;
    if (index < queue.length - 1) {
      // Synchronous play() preserves the user-gesture token; the effect that
      // would otherwise handle this fires too late on React 19.
      loadAndPlay(queue[index + 1] ?? null, true);
      setIndex(index + 1);
    }
  }, [index, queue, setIndex, loadAndPlay]);

  const prev = useCallback(() => {
    userInteracted.current = true;
    const a = audioRef.current;
    if (a && a.currentTime > 3) { a.currentTime = 0; return; }
    if (index > 0) {
      loadAndPlay(queue[index - 1] ?? null, true);
      setIndex(index - 1);
    }
  }, [index, queue, setIndex, loadAndPlay]);

  // Audio event hookups: time, meta, ended, play, pause.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      const pos = a.currentTime || 0;
      setPosition(pos);
      if (!isTransitioning.current && pos > 0.5) {
        lastValidPosition.current = pos;
        const now = Date.now();
        if (now - lastPosWrite.current > 1000) {
          lastPosWrite.current = now;
          usePlayerStore.setState({ position: pos });
        }
      }
    };
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => next();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
    };
  }, [audioReady, next, setDuration, setIsPlaying, setPosition]);

  // Position persistence — separate cadence; never overwrites with sus 0 during track swap.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const savePosition = () => {
      if (isTransitioning.current) return;
      const pos = a.currentTime || 0;
      const havePlayable = a.duration && a.duration !== Infinity && a.duration > 0;
      const trustworthyPos = pos > 0.5 ? pos : lastValidPosition.current;
      if (!havePlayable && trustworthyPos < 0.5) return;
      usePlayerStore.setState({ position: trustworthyPos });
    };
    const periodic = setInterval(() => { if (!a.paused) savePosition(); }, 5000);
    const onVisibility = () => { if (document.hidden) savePosition(); };
    const onPause = () => savePosition();
    const onPagehide = () => savePosition();
    a.addEventListener('pause', onPause);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPagehide);
    return () => {
      clearInterval(periodic);
      a.removeEventListener('pause', onPause);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPagehide);
    };
  }, [audioReady]);

  // Radio mode: when at end of queue, fetch recommended and extend. The
  // candidates from getRecommended() are already same-style as the current
  // track (YouTube's "watch next"); we layer two priority rules on top:
  //
  //   1. If we entered playback from an artist page, filter OUT more by the
  //      same artist so the listener drifts into similar-genre songs by other
  //      artists once the catalog runs out.
  //   2. Re-rank surviving candidates by the user's personal play count, so
  //      heavily-played tracks within the same style get surfaced first.
  //      "Heavily played" stands in for "preferred genre" since the candidate
  //      pool is already genre-similar.
  useEffect(() => {
    if (!current?.sourceId) return;
    if (index !== queue.length - 1) return;
    if (fetchingRadioFor.current === current.id) return;
    fetchingRadioFor.current = current.id;
    const currentId = current.id;
    const currentSourceId = current.sourceId;
    const activeContext = context;

    api.getRecommended(currentSourceId).then(({ tracks }) => {
      // Block re-playing the current song or any *version* of it, plus
      // variants of anything already queued. songKey() ignores
      // "(Official Video)" / "(Live)" / "(Remix)" noise so we don't line up
      // five cuts of the same track. Also dedups variants within the pool.
      const blockedKeys = new Set<string>([songKey(current), ...queue.map(songKey)]);
      const queuedIds = new Set(queue.map((q) => q.id));
      const seenKeys = new Set<string>();
      let pool = tracks.filter((t) => {
        if (t.id === currentId || queuedIds.has(t.id)) return false;
        const k = songKey(t);
        if (blockedKeys.has(k) || seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      });

      // Artist context: once the catalog is done, drift to other artists.
      if (activeContext?.type === 'artist' && activeContext.artistName) {
        const targetArtist = activeContext.artistName.toLowerCase();
        pool = pool.filter((t) => (t.artist ?? '').toLowerCase() !== targetArtist);
      }

      // Build per-track play counts from history. History rows are unique
      // by recordPlay's collapsing (we just count occurrences here, which
      // already reflects how often the user has hit play).
      const playCount = new Map<string, number>();
      for (const t of history) playCount.set(t.id, (playCount.get(t.id) ?? 0) + 1);
      const likedIds = new Set(liked.map((t) => t.id));

      // Split into "known" (played-before within this genre-similar pool) and
      // "fresh" (new discoveries). Known gets sorted by play count desc,
      // tie-break by liked. Fresh keeps the source order from getRecommended.
      const known = pool
        .filter((t) => playCount.has(t.id))
        .sort((a, b) => {
          const ca = playCount.get(a.id) ?? 0;
          const cb = playCount.get(b.id) ?? 0;
          if (cb !== ca) return cb - ca;
          return Number(likedIds.has(b.id)) - Number(likedIds.has(a.id));
        });
      const fresh = pool.filter((t) => !playCount.has(t.id));

      // Front-load 2 favorites so the transition feels personal, then weave
      // 1 favorite every 3 tracks to keep discovery alive.
      const merged: Track[] = [];
      let ki = 0;
      let fi = 0;
      const FRONT_LOAD = Math.min(2, known.length);
      while (ki < FRONT_LOAD) merged.push(known[ki++]);
      while (ki < known.length || fi < fresh.length) {
        if (ki < known.length && merged.length % 3 === 0) merged.push(known[ki++]);
        else if (fi < fresh.length) merged.push(fresh[fi++]);
        else if (ki < known.length) merged.push(known[ki++]);
      }
      if (merged.length > 0) setQueue([...queue, ...merged]);
    }).catch(() => {}).finally(() => {
      if (fetchingRadioFor.current === currentId) fetchingRadioFor.current = null;
    });
  }, [current?.id, current?.sourceId, index, queue, history, liked, context, setQueue]);

  // Discord rich presence.
  useEffect(() => {
    api.updateDiscord(current, isPlaying).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isPlaying]);

  // Media Session metadata.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title ?? '',
      artist: current.artist ?? '',
      album: current.album ?? '',
      artwork: current.artworkUrl ? [{ src: current.artworkUrl, sizes: '512x512' }] : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const seek = useCallback((sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(sec, a.duration || 0));
  }, []);

  // Media Session action handlers — wired to lock-screen/Bluetooth.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const a = audioRef.current;
    if (!a) return;
    navigator.mediaSession.setActionHandler('play', () => { void a.play(); });
    navigator.mediaSession.setActionHandler('pause', () => a.pause());
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('seekto', (e) => {
      if (typeof e.seekTime === 'number') seek(e.seekTime);
    });
    return () => {
      (['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as const).forEach((act) =>
        navigator.mediaSession.setActionHandler(act, null),
      );
    };
  }, [audioReady, prev, next, seek]);

  const playTrack = useCallback((track: Track, list?: Track[], nextContext?: PlaybackContext | null) => {
    userInteracted.current = true;
    // Synchronously start playback so the user-gesture token isn't lost
    // before audio.play() fires (React 19 schedules effects async).
    loadAndPlay(track, true);
    // Searching for a song and tapping it should play just that song, then
    // flow into radio — NOT walk through the (variant-heavy) results list.
    // Other contexts (artist/playlist) still queue their whole list in order.
    const isSearch = nextContext?.type === 'search';
    const queueList = !isSearch && list && list.length ? list : [track];
    const i = queueList.findIndex((t) => t.id === track.id);
    // Atomic update: queue + index + context flip in one store transition so
    // subscribers never see queue[i] === undefined on an intermediate render.
    // Default to 'single' when a caller didn't specify.
    usePlayerStore.setState({
      queue: queueList,
      index: i >= 0 ? i : 0,
      context: nextContext ?? { type: 'single' },
    });
    logger.breadcrumb('playback', 'play', { trackId: track.id, source: track.source, context: nextContext?.type ?? 'single' });
  }, [loadAndPlay]);

  const toggle = useCallback(() => {
    userInteracted.current = true;
    const a = audioRef.current;
    if (!current || !a) return;
    if (a.paused) { void a.play(); logger.breadcrumb('playback', 'resume', { trackId: current.id }); }
    else { a.pause(); logger.breadcrumb('playback', 'pause', { trackId: current.id }); }
  }, [current]);

  const setVolume = useCallback(
    (v: number) => setStoreVolume(Math.max(0, Math.min(1, v))),
    [setStoreVolume],
  );

  const value = useMemo<PlayerControls>(
    () => ({
      current, isPlaying, position, duration, volume, queue, index, context,
      playTrack, toggle, next, prev, seek, setVolume,
    }),
    [current, isPlaying, position, duration, volume, queue, index, context, playTrack, toggle, next, prev, seek, setVolume],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
