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
import { useSessionStore } from '@/stores/useSessionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteRecordPlay, useQueryHistory, useQueryLikes } from '@/hooks/useLibrary';
import { useQueryLyrics } from '@/hooks/useLyrics';
import { api, apiUrl } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { songKey } from '@/lib/songKey';
import { detectShell } from '@/lib/playback/detectShell';
import { createWebBackend } from '@/lib/playback/webBackend';
import { createCapacitorBackend } from '@/lib/playback/capacitorBackend';
import { createNativeBackend, nativeBackendReady } from '@/lib/playback/nativeBridge';
import { createTauriBackend } from '@/lib/playback/tauriBackend';
import type { AudioBackend, AudioBackendEvents } from '@/lib/playback/types';
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

/** Player provider — owns a swappable AudioBackend (web <audio> today, native
 *  bridge in the shells) and orchestrates playback, persistence-on-write merges,
 *  radio mode, Discord, and remote/media controls. The backend is ref-held and
 *  built on first client render; `backendReady` re-runs dependent effects once
 *  it exists. PlayerControls is identical to before — no consumer changes. */
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

  const { user } = useAuth();
  const { data: history = [] } = useQueryHistory();
  const { data: liked = [] } = useQueryLikes();
  const recordPlay = useExecuteRecordPlay();

  const backendRef = useRef<AudioBackend | null>(null);
  const [backendReady, setBackendReady] = useState(false);

  const userInteracted = useRef(false);
  // null = "uninitialized, fall back to the persisted store value on read."
  // zustand-persist rehydration completes AFTER first render, so we can't seed
  // from `position`; deferring the lookup to loadAndPlay (effect time) is safe.
  const wantPosition = useRef<number | null>(null);
  const lastValidPosition = useRef(position);
  const lastPosWrite = useRef(0);
  const fetchingRadioFor = useRef<string | null>(null);

  // Latest-callback refs so remote commands / onEnded call current logic
  // without re-registering handlers or rebuilding the backend.
  const nextRef = useRef<() => void>(() => {});
  const prevRef = useRef<() => void>(() => {});
  const persistRef = useRef<() => void>(() => {});

  const current = queue[index] ?? null;

  // Ambient lyrics prefetch — fires the moment a track becomes current, so the
  // panel has data ready when opened (React Query caches it).
  useQueryLyrics(current, true);

  const partyVolume = useSettingsStore((s) => s.partyVolume);
  const muted = usePlayerStore((s) => s.muted);
  const loopMode = usePlayerStore((s) => s.loopMode);

  // Persist the trustworthy position to the store. Skips during a transition
  // (the element reports transient values) and never overwrites with a sus 0.
  const persistPosition = useCallback(() => {
    const b = backendRef.current;
    if (!b || b.isTransitioning()) return;
    const pos = b.getCurrentTime();
    const dur = b.getDuration();
    const havePlayable = dur && dur !== Infinity && dur > 0;
    const trustworthyPos = pos > 0.5 ? pos : lastValidPosition.current;
    if (!havePlayable && trustworthyPos < 0.5) return;
    usePlayerStore.setState({ position: trustworthyPos });
  }, []);
  useEffect(() => {
    persistRef.current = persistPosition;
  }, [persistPosition]);

  // Build the backend once, on first client render. Events map straight to the
  // store writes the old element listeners performed.
  useEffect(() => {
    if (backendRef.current) return;
    const events: AudioBackendEvents = {
      onTime: (sec) => {
        setPosition(sec);
        if (!backendRef.current?.isTransitioning() && sec > 0.5) {
          lastValidPosition.current = sec;
          const now = Date.now();
          if (now - lastPosWrite.current > 1000) {
            lastPosWrite.current = now;
            usePlayerStore.setState({ position: sec });
          }
        }
      },
      onDuration: (d) => setDuration(d),
      onEnded: () => {
        // Read the latest loop state at fire time so a stale closure can't lock
        // us into the wrong mode.
        const state = usePlayerStore.getState();
        const cur = state.queue[state.index];
        if (state.loopMode === 'one' && cur) {
          backendRef.current?.seek(0);
          backendRef.current?.play();
          return;
        }
        nextRef.current();
      },
      onPlay: () => setIsPlaying(true),
      onPause: () => {
        setIsPlaying(false);
        persistRef.current();
      },
      onError: () => {
        setPosition(0);
        setIsPlaying(false);
        usePlayerStore.setState({ position: 0 });
      },
    };
    // Per-shell backend: tauri has a native engine (Part 5); capacitor keeps
    // web audio but mirrors the session to the native media-session plugin
    // (Part 3a — foreground service = background playback); plain web uses the
    // bare <audio> backend.
    const shell = detectShell();
    let create = createWebBackend;
    if (shell === 'capacitor') {
      create = createCapacitorBackend;
    } else if (shell !== 'web' && nativeBackendReady(shell)) {
      create = shell === 'tauri' ? createTauriBackend : createNativeBackend;
    }
    backendRef.current = create(events);
    setBackendReady(true);
    return () => {
      backendRef.current?.destroy();
      backendRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Volume curve + party gain. Muted forces 0 (stored value preserved).
  useEffect(() => {
    const b = backendRef.current;
    if (!b) return;
    b.setVolume(muted ? 0 : volume, { gain: partyVolume ? 2 : 1 });
  }, [backendReady, volume, partyVolume, muted]);

  // When party mode turns OFF, snap volume back under the normal 0.85 cap so the
  // slider thumb doesn't stick at the right edge.
  useEffect(() => {
    if (!partyVolume && volume > 0.85) {
      setStoreVolume(0.85);
    }
  }, [partyVolume, volume, setStoreVolume]);

  // Load + (optionally) play a track. Must run from a user gesture for autoplay
  // (React 19 effects are async and lose the activation token). The first call
  // restores the persisted position; later calls start fresh (wantPosition→0).
  const loadAndPlay = useCallback((track: Track | null, autoplay: boolean) => {
    const b = backendRef.current;
    if (!b) return;
    if (!track) {
      b.stop();
      b.setMetadata(null);
      return;
    }
    const startAt = wantPosition.current ?? usePlayerStore.getState().position;
    wantPosition.current = 0;
    b.load(apiUrl(track.streamUrl), { autoplay, startAt });
    // Set metadata in the same synchronous turn so the notification carries
    // across a track boundary (Firefox Android tears it down otherwise).
    b.setMetadata(track);
  }, []);

  // Drives load+autoplay on track changes from outside playTrack — auto-advance
  // (onEnded → next → index change) and cold-load hydration of a persisted queue.
  useEffect(() => {
    if (!backendReady) return;
    loadAndPlay(current, userInteracted.current);
    if (current && userInteracted.current && user) recordPlay.mutate(current);
    if (!current) {
      setIsPlaying(false);
      setPosition(0);
      setDuration(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendReady, current?.id]);

  const next = useCallback(() => {
    userInteracted.current = true;
    const loop = usePlayerStore.getState().loopMode;
    if (index < queue.length - 1) {
      // Synchronous load preserves the user-gesture token; the id-effect would
      // fire too late on React 19.
      loadAndPlay(queue[index + 1] ?? null, true);
      setIndex(index + 1);
      return;
    }
    // At the end of the queue: with loop-all on, the Next button wraps back to
    // the first track (matches the auto-advance wrap in onEnd).
    if (loop === 'all' && queue.length > 0) {
      loadAndPlay(queue[0] ?? null, true);
      setIndex(0);
    }
  }, [index, queue, setIndex, loadAndPlay]);

  const prev = useCallback(() => {
    userInteracted.current = true;
    const b = backendRef.current;
    const loop = usePlayerStore.getState().loopMode;
    // First track + loop-all → wrap to the last track, regardless of how far
    // into the song we are (checked BEFORE the >3s restart so the wrap isn't
    // swallowed by restart-current at the start of the queue).
    if (index === 0 && loop === 'all' && queue.length > 0) {
      loadAndPlay(queue[queue.length - 1] ?? null, true);
      setIndex(queue.length - 1);
      return;
    }
    if (b && b.getCurrentTime() > 3) {
      b.seek(0);
      return;
    }
    if (index > 0) {
      loadAndPlay(queue[index - 1] ?? null, true);
      setIndex(index - 1);
    }
  }, [index, queue, setIndex, loadAndPlay]);

  useEffect(() => {
    nextRef.current = next;
  }, [next]);
  useEffect(() => {
    prevRef.current = prev;
  }, [prev]);

  // Position persistence — periodic + on leave moments. Never overwrites with a
  // sus 0 during a track swap (persistPosition guards on isTransitioning).
  useEffect(() => {
    if (!backendReady) return;
    const b = backendRef.current;
    if (!b) return;
    const periodic = setInterval(() => {
      if (!b.isPaused()) persistPosition();
    }, 5000);
    const onVisibility = () => {
      if (document.hidden) persistPosition();
    };
    const onPagehide = () => persistPosition();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPagehide);
    return () => {
      clearInterval(periodic);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPagehide);
    };
  }, [backendReady, persistPosition]);

  // Radio mode: at end of queue, fetch recommended (same-style) and extend.
  // Artist context drifts to other artists once the catalog runs out; survivors
  // re-ranked by the user's personal play count.
  useEffect(() => {
    if (!current?.sourceId) return;
    // Loop-all wraps the queue instead of extending it — don't pull in radio.
    // Reactive (not getState): when the user turns loop OFF the effect must
    // re-run, otherwise a 1-track queue that skipped extension while looping
    // stays 1 track forever — un-skippable, looping "even with the toggle off".
    if (loopMode === 'all') return;
    // Hosting a live carlist session: the queue is exactly what the group
    // added — no radio extension.
    if (useSessionStore.getState().hostingSessionId) return;
    if (index !== queue.length - 1) return;
    if (fetchingRadioFor.current === current.id) return;
    fetchingRadioFor.current = current.id;
    const currentId = current.id;
    const currentSourceId = current.sourceId;
    const activeContext = context;

    api.getRecommended(currentSourceId).then(({ tracks }) => {
      // Block re-playing the current song or any variant of it, plus variants of
      // anything already queued. songKey() ignores "(Official Video)" etc.
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

      if (activeContext?.type === 'artist' && activeContext.artistName) {
        const targetArtist = activeContext.artistName.toLowerCase();
        pool = pool.filter((t) => (t.artist ?? '').toLowerCase() !== targetArtist);
      }

      const playCount = new Map<string, number>();
      for (const t of history) playCount.set(t.id, (playCount.get(t.id) ?? 0) + 1);
      const likedIds = new Set(liked.map((t) => t.id));

      const known = pool
        .filter((t) => playCount.has(t.id))
        .sort((a, b) => {
          const ca = playCount.get(a.id) ?? 0;
          const cb = playCount.get(b.id) ?? 0;
          if (cb !== ca) return cb - ca;
          return Number(likedIds.has(b.id)) - Number(likedIds.has(a.id));
        });
      const fresh = pool.filter((t) => !playCount.has(t.id));

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
      logger.breadcrumb('radio', 'extend', {
        context: activeContext?.type ?? 'single',
        seed: currentSourceId,
        recs: tracks.length,
        added: merged.length,
      });
      if (merged.length > 0) setQueue([...queue, ...merged]);
    }).catch((e) => {
      logger.error('radio', 'recommended fetch failed', { context: activeContext?.type ?? 'single', seed: currentSourceId }, e as Error);
    }).finally(() => {
      if (fetchingRadioFor.current === currentId) fetchingRadioFor.current = null;
    });
  }, [current?.id, current?.sourceId, index, queue, history, liked, context, loopMode, setQueue]);

  // Discord rich presence.
  useEffect(() => {
    api.updateDiscord(current, isPlaying).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isPlaying]);

  // Media metadata backstop for track changes that don't flow through
  // loadAndPlay (hydration on cold load). loadAndPlay sets it synchronously.
  useEffect(() => {
    backendRef.current?.setMetadata(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const seek = useCallback((sec: number) => {
    backendRef.current?.seek(sec);
  }, []);

  // Wire OS/remote transport once the backend exists. next/prev go through refs
  // so the handlers stay current without re-registering.
  useEffect(() => {
    if (!backendReady) return;
    const b = backendRef.current;
    if (!b) return;
    b.setRemoteCommands({
      play: () => b.play(),
      pause: () => b.pause(),
      next: () => nextRef.current(),
      prev: () => prevRef.current(),
      seek: (sec) => b.seek(sec),
    });
  }, [backendReady]);

  const playTrack = useCallback((track: Track, list?: Track[], nextContext?: PlaybackContext | null) => {
    userInteracted.current = true;
    // Synchronously start so the user-gesture token survives (React 19 effects
    // are async).
    loadAndPlay(track, true);
    // Tapping a search result plays just that song then flows into radio — not
    // the variant-heavy results list. Other contexts queue their whole list.
    const isSearch = nextContext?.type === 'search';
    const queueList = !isSearch && list && list.length ? list : [track];
    const i = queueList.findIndex((t) => t.id === track.id);
    usePlayerStore.setState({
      queue: queueList,
      index: i >= 0 ? i : 0,
      context: nextContext ?? { type: 'single' },
    });
    logger.breadcrumb('playback', 'play', { trackId: track.id, source: track.source, context: nextContext?.type ?? 'single' });
  }, [loadAndPlay]);

  // Global keyboard shortcuts: Space play/pause, M mute, ←/→ seek ∓5s, ↑/↓ vol.
  // Skipped while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      const cur = usePlayerStore.getState().queue[usePlayerStore.getState().index];
      if (!cur) return;
      const b = backendRef.current;

      if (e.code === 'Space' || e.key === ' ') {
        if (e.repeat) return;
        e.preventDefault();
        if (b) {
          if (b.isPaused()) b.play();
          else b.pause();
        }
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        if (e.repeat) return;
        e.preventDefault();
        usePlayerStore.getState().toggleMuted();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!b) return;
        e.preventDefault();
        const step = e.key === 'ArrowLeft' ? -5 : 5;
        b.seek(b.getCurrentTime() + step);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const state = usePlayerStore.getState();
        if (state.muted) state.setMuted(false);
        const step = e.key === 'ArrowUp' ? 0.05 : -0.05;
        const ceiling = useSettingsStore.getState().partyVolume ? 1 : 0.85;
        state.setVolume(Math.max(0, Math.min(ceiling, state.volume + step)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggle = useCallback(() => {
    userInteracted.current = true;
    const b = backendRef.current;
    if (!current || !b) return;
    if (b.isPaused()) {
      b.play();
      logger.breadcrumb('playback', 'resume', { trackId: current.id });
    } else {
      b.pause();
      logger.breadcrumb('playback', 'pause', { trackId: current.id });
    }
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
