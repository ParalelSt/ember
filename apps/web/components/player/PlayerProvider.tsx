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
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteRecordPlay, useQueryHistory, useQueryLikes } from '@/hooks/useLibrary';
import { api, apiUrl } from '@/lib/api';
import type { Track } from '@/types/track';

interface PlayerControls {
  current: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  queue: Track[];
  index: number;
  playTrack: (track: Track, list?: Track[]) => void;
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
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setIndex = usePlayerStore((s) => s.setIndex);
  const setPosition = usePlayerStore((s) => s.setPosition);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setStoreVolume = usePlayerStore((s) => s.setVolume);

  const { user } = useAuth();
  const { data: history = [] } = useQueryHistory();
  const { data: liked = [] } = useQueryLikes();
  const recordPlay = useExecuteRecordPlay();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  const userInteracted = useRef(false);
  const wantPosition = useRef(position);
  const isTransitioning = useRef(false);
  const lastValidPosition = useRef(position);
  const lastPosWrite = useRef(0);
  const fetchingRadioFor = useRef<string | null>(null);

  useEffect(() => {
    if (audioRef.current) return;
    const a = new Audio();
    a.preload = 'metadata';
    audioRef.current = a;
    setAudioReady(true);
  }, []);

  const current = queue[index] ?? null;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume * volume;
  }, [audioReady, volume]);

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
    const restoreTo = wantPosition.current;
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

  // Radio mode: when at end of queue, fetch recommended and extend.
  useEffect(() => {
    if (!current?.sourceId) return;
    if (index !== queue.length - 1) return;
    if (fetchingRadioFor.current === current.id) return;
    fetchingRadioFor.current = current.id;
    const currentId = current.id;
    const currentSourceId = current.sourceId;

    api.getRecommended(currentSourceId).then(({ tracks }) => {
      const knownIds = new Set([...history.map((t) => t.id), ...liked.map((t) => t.id)]);
      const filtered = tracks.filter((t) => t.id !== currentId && !queue.some((q) => q.id === t.id));
      const known = filtered.filter((t) => knownIds.has(t.id));
      const fresh = filtered.filter((t) => !knownIds.has(t.id));
      const merged: Track[] = [];
      let ki = 0;
      let fi = 0;
      while (ki < known.length || fi < fresh.length) {
        if (ki < known.length && merged.length % 3 === 0) merged.push(known[ki++]);
        else if (fi < fresh.length) merged.push(fresh[fi++]);
        else if (ki < known.length) merged.push(known[ki++]);
      }
      if (merged.length > 0) setQueue([...queue, ...merged]);
    }).catch(() => {}).finally(() => {
      if (fetchingRadioFor.current === currentId) fetchingRadioFor.current = null;
    });
  }, [current?.id, current?.sourceId, index, queue, history, liked, setQueue]);

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

  const playTrack = useCallback((track: Track, list?: Track[]) => {
    userInteracted.current = true;
    // Synchronously start playback so the user-gesture token isn't lost
    // before audio.play() fires (React 19 schedules effects async).
    loadAndPlay(track, true);
    if (list && list.length) {
      const i = list.findIndex((t) => t.id === track.id);
      setQueue(list);
      setIndex(i >= 0 ? i : 0);
    } else {
      setQueue([track]);
      setIndex(0);
    }
  }, [setQueue, setIndex, loadAndPlay]);

  const toggle = useCallback(() => {
    userInteracted.current = true;
    const a = audioRef.current;
    if (!current || !a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, [current]);

  const setVolume = useCallback(
    (v: number) => setStoreVolume(Math.max(0, Math.min(1, v))),
    [setStoreVolume],
  );

  const value = useMemo<PlayerControls>(
    () => ({
      current, isPlaying, position, duration, volume, queue, index,
      playTrack, toggle, next, prev, seek, setVolume,
    }),
    [current, isPlaying, position, duration, volume, queue, index, playTrack, toggle, next, prev, seek, setVolume],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
