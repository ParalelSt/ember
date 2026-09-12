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
import { toast } from 'sonner';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { localArtFor, localSrcFor } from '@/lib/offlineNative';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteRecordPlay, useQueryHistory, useQueryLikes } from '@/hooks/useLibrary';
import { useQueryLyrics } from '@/hooks/useLyrics';
import { apiUrl } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { detectShell } from '@/lib/playback/detectShell';
import { chooseDuration } from '@/lib/playback/chooseDuration';
import { isUnavailable, nextIndex, nextPlayable, prevIndex } from '@/lib/playback/queueNav';
import { useAvailabilityProbe } from '@/hooks/player/useAvailabilityProbe';
import { useDiscordPresence } from '@/hooks/player/useDiscordPresence';
import { usePositionPersistence } from '@/hooks/player/usePositionPersistence';
import { useRadioExtend } from '@/hooks/player/useRadioExtend';
import { useKeyboardShortcuts } from '@/hooks/player/useKeyboardShortcuts';
import { useRemoteCommands } from '@/hooks/player/useRemoteCommands';
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

/** Toast for tracks passed over on the way to a playable one. One skip names
 *  the track; more than one just gives the count (naming several would be
 *  noise). No-op on an empty list. */
function toastSkipped(skipped: Track[]) {
  if (skipped.length === 1) {
    toast(`Skipped: "${skipped[0].title}" is unavailable`);
  } else if (skipped.length > 1) {
    toast(`Skipped ${skipped.length} unavailable songs`);
  }
}

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
  /** Which engine is live, and whether we've already swapped away from a
   *  broken native one (only ever done once — a fallback loop would be worse
   *  than the original fault). */
  const backendKindRef = useRef<'web' | 'capacitor' | 'tauri-native' | 'native-stub'>('web');
  const fellBackRef = useRef(false);
  /** Track id currently handed to the backend — guards redundant re-loads. */
  const loadedTrackRef = useRef<string | null>(null);
  /** Track id whose CURRENTLY loaded src is a downloaded local file, else null.
   *  onError needs it to know whether retrying over the network is worth
   *  anything. */
  const localSrcTrackRef = useRef<string | null>(null);
  /** Track id we have already swapped from its local file to the stream, so a
   *  stream that also fails cannot bounce back and forth. */
  const streamFallbackRef = useRef<string | null>(null);
  const eventsRef = useRef<AudioBackendEvents | null>(null);
  const loadAndPlayRef = useRef<((t: Track | null, autoplay: boolean) => void) | null>(null);
  const fallbackToWebAudioRef = useRef<((reason: string) => void) | null>(null);
  const [backendReady, setBackendReady] = useState(false);

  const userInteracted = useRef(false);

  // Latest-callback refs so remote commands / onEnded call current logic
  // without re-registering handlers or rebuilding the backend.
  const nextRef = useRef<() => void>(() => {});
  const prevRef = useRef<() => void>(() => {});

  const current = queue[index] ?? null;

  // Ambient lyrics prefetch — fires the moment a track becomes current, so the
  // panel has data ready when opened (React Query caches it).
  useQueryLyrics(current, true);

  const partyVolume = useSettingsStore((s) => s.partyVolume);
  const muted = usePlayerStore((s) => s.muted);
  const loopMode = usePlayerStore((s) => s.loopMode);

  // The stored playhead: who owns it, when it is written, where a track
  // resumes. Called here, before the backend is built, because the backend's
  // events report positions and persist on pause.
  const positions = usePositionPersistence({ backendRef, backendReady });

  // Stable callback, so the backend's one-time event object can close over
  // it: asks the server whether a failing track has actually died.
  const probeAvailability = useAvailabilityProbe(nextRef);

  // Build the backend once, on first client render. Events map straight to the
  // store writes the old element listeners performed.
  useEffect(() => {
    if (backendRef.current) return;
    const events: AudioBackendEvents = {
      onTime: (sec) => {
        setPosition(sec);
        positions.noteTime(sec);
      },
      onDuration: (d) => {
        // The engine's figure is a second opinion, not the truth: see
        // chooseDuration. A desktop decoder streaming over HTTP often has no
        // idea how long the song is.
        const st = usePlayerStore.getState();
        setDuration(chooseDuration(st.queue[st.index]?.durationSec ?? 0, d));
      },
      onEnded: () => {
        // Read the latest loop state at fire time so a stale closure can't lock
        // us into the wrong mode.
        const state = usePlayerStore.getState();
        const cur = state.queue[state.index];
        logger.breadcrumb('playback', 'ended', { trackId: cur?.id ?? null });
        if (state.loopMode === 'one' && cur) {
          backendRef.current?.seek(0);
          backendRef.current?.play();
          return;
        }
        nextRef.current();
      },
      // onPlay/onPause fire for every real backend transition: user toggle,
      // remote command, auto-advance, recovery: so this is the one place
      // 'play'/'pause' breadcrumbs are recorded (a per-caller breadcrumb in
      // toggle() would double them up).
      // Both are idempotent: the web backend reports play twice (the 'play'
      // event and the play() promise), so only a real flip leaves a breadcrumb.
      onPlay: () => {
        const cur = usePlayerStore.getState();
        if (cur.isPlaying) return;
        setIsPlaying(true);
        logger.breadcrumb('playback', 'play', { trackId: cur.queue[cur.index]?.id ?? null });
      },
      onPause: () => {
        // Always persist (a pause is a leave moment even when the store
        // already says paused); only the flip and its breadcrumb are guarded.
        positions.persistRef.current();
        const cur = usePlayerStore.getState();
        if (!cur.isPlaying) return;
        setIsPlaying(false);
        logger.breadcrumb('playback', 'pause', { trackId: cur.queue[cur.index]?.id ?? null });
      },
      onError: () => {
        // A native engine that can't play is worse than no native engine:
        // retry this track on web audio before giving up on it.
        if (backendKindRef.current === 'tauri-native' && !fellBackRef.current) {
          fallbackToWebAudioRef.current?.('audio backend reported an error');
          return;
        }
        // A downloaded file that will not play (deleted under us, or a
        // half-written one) must not cost the song: stream it instead, once,
        // from where the playhead was. Offline there is nothing to fall back
        // to, so the normal error handling stands.
        const st = usePlayerStore.getState();
        const track = st.queue[st.index];
        const online = typeof navigator === 'undefined' || navigator.onLine;
        if (track && online && localSrcTrackRef.current === track.id && streamFallbackRef.current !== track.id) {
          streamFallbackRef.current = track.id;
          localSrcTrackRef.current = null;
          // Drop the dead path so the next play does not retry it. The native
          // plugin's next status() event is still the source of truth.
          useOfflineStore.getState().dropTrackFile(track.id);
          logger.error('playback', 'downloaded file would not play, streaming instead', { trackId: track.id });
          positions.requestStartAt(positions.resumeTargetFor(track.id));
          loadAndPlayRef.current?.(track, true);
          return;
        }
        setPosition(0);
        setIsPlaying(false);
        usePlayerStore.setState({ position: 0 });
        // Was the track itself the problem? The probe asks the server, flags
        // the queue entry if so, and skips on. See useAvailabilityProbe.
        probeAvailability();
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
    eventsRef.current = events;
    backendKindRef.current = create === createWebBackend ? 'web'
      : create === createCapacitorBackend ? 'capacitor'
      : create === createTauriBackend ? 'tauri-native' : 'native-stub';
    backendRef.current = create(events);
    // lib/logger has no ref to backendKindRef, so the provider is the one
    // place that pushes it into the context envelope (see logger.setContext).
    logger.setContext({ backendKind: backendKindRef.current });
    // Visible in devtools; tells you instantly whether the desktop app is on
    // the Rust engine or fell back to web audio.
    logger.breadcrumb('playback', 'backend selected', {
      shell,
      backend: create === createWebBackend ? 'web'
        : create === createCapacitorBackend ? 'capacitor'
        : create === createTauriBackend ? 'tauri-native' : 'native-stub',
    });
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

  /** Swap a failing native engine for plain web audio, once, and resume.
   *
   *  nativeBackendReady() can only check that Tauri's invoke() EXISTS — and it
   *  does even when the capability denies every command, which is precisely
   *  what shipped in v0.2.0: the app chose the Rust engine, every call was
   *  refused, and the result was silence with a track apparently playing.
   *  A dead native engine must cost OS media keys, never the music. */
  const fallbackToWebAudio = useCallback((reason: string) => {
    if (backendKindRef.current === 'web' || fellBackRef.current) return;
    fellBackRef.current = true;
    logger.error('playback', 'native audio failed — falling back to web audio', { reason });

    const events = eventsRef.current;
    const st0 = usePlayerStore.getState();
    const failing = st0.queue[st0.index];
    const resumeAt = failing ? positions.resumeTargetFor(failing.id) : 0;
    try { backendRef.current?.destroy(); } catch { /* already broken */ }

    backendRef.current = createWebBackend(events!);
    backendKindRef.current = 'web';
    logger.setContext({ backendKind: 'web' });
    // partyVolume lives in the settings store, not the player store.
    const st = usePlayerStore.getState();
    const party = useSettingsStore.getState().partyVolume;
    backendRef.current.setVolume(st.muted ? 0 : st.volume, { gain: party ? 2 : 1 });

    const track = st.queue[st.index];
    if (track) {
      positions.requestStartAt(resumeAt);
      loadAndPlayRef.current?.(track, true);
    }
    // `positions` is a stable object of stable callbacks, so this callback's
    // identity does not change: it is listed to satisfy the deps rule, not
    // because it can ever differ.
  }, [positions]);

  // Load + (optionally) play a track. Must run from a user gesture for autoplay
  // (React 19 effects are async and lose the activation token). The first call
  // restores the persisted position; later calls start fresh (see
  // usePositionPersistence).
  const loadAndPlay = useCallback((track: Track | null, autoplay: boolean) => {
    const b = backendRef.current;
    if (!b) return;
    if (!track) {
      b.stop();
      b.setMetadata(null);
      loadedTrackRef.current = null;
      return;
    }
    // Cold-start hydration runs more than once (three times, in a traced
    // launch), and each pass re-downloads and re-decodes the same track. Worse,
    // those loads carry autoplay=false: if one lands just after the user hits
    // play, it replaces their playing audio with a PAUSED sink — the "had to
    // click play a few times" bug. A silent re-load of the track that's already
    // loaded is never useful, so drop it.
    if (!autoplay && loadedTrackRef.current === track.id) return;
    loadedTrackRef.current = track.id;
    // Hands the stored playhead to this track and returns where it resumes.
    const startAt = positions.startAt(track.id);
    // Same for the length. Without this the slider keeps the PREVIOUS song's
    // duration until the engine volunteers one, which on desktop it often
    // never does.
    setDuration(chooseDuration(track.durationSec ?? 0, null));
    // A downloaded copy plays even online: instant, and no data used.
    const local = localSrcFor(track, useOfflineStore.getState().trackFiles);
    localSrcTrackRef.current = local ? track.id : null;
    // Only a fresh LOCAL load re-arms the one-shot stream fallback; the
    // fallback's own load is not local, so it cannot re-arm itself.
    if (local) streamFallbackRef.current = null;
    logger.breadcrumb('playback', 'load', {
      trackId: track.id,
      backend: backendKindRef.current,
      source: local ? 'local' : 'stream',
    });
    b.load(local ?? apiUrl(track.streamUrl), { autoplay, startAt });
    // Set metadata in the same synchronous turn so the notification carries
    // across a track boundary (Firefox Android tears it down otherwise).
    // Local art (the same downloaded copy) wins over the remote artworkUrl.
    b.setMetadata(track, localArtFor(track, useOfflineStore.getState().artFiles));
  }, [positions]);

  loadAndPlayRef.current = loadAndPlay;
  fallbackToWebAudioRef.current = fallbackToWebAudio;

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

  /** The loop and next/prev rules live in lib/playback/queueNav. Loop mode,
   *  context and baseCount are read at call time so a stale closure can't
   *  navigate by the wrong mode. */
  const navState = useCallback(() => {
    const st = usePlayerStore.getState();
    return { queue, index, loopMode: st.loopMode, context: st.context, baseCount: st.baseCount };
  }, [queue, index]);

  /** Advance to the first playable track at/after `target` (walking by
   *  `step`, wrapping under loop-all), toasting whatever it skips over. Used
   *  by next/prev instead of jumping straight to `target` so an unavailable
   *  track never becomes "current" even for an instant. */
  const goTo = useCallback((target: number, step: 1 | -1) => {
    const st = usePlayerStore.getState();
    const r = nextPlayable(st.queue, target, step, st.loopMode === 'all');
    toastSkipped(r.skipped);
    if (r.index < 0) {
      toast.error('Nothing left to play');
      return;
    }
    loadAndPlay(st.queue[r.index], true);
    setIndex(r.index);
  }, [loadAndPlay, setIndex]);

  const next = useCallback(() => {
    userInteracted.current = true;
    const move = nextIndex(navState());
    if (!move) return;
    // goTo, not loadAndPlay: it walks past anything unavailable before it
    // can become "current" even for an instant.
    goTo(move.index, 1);
  }, [goTo, navState]);

  const prev = useCallback(() => {
    userInteracted.current = true;
    const b = backendRef.current;
    const move = prevIndex(navState(), b ? b.getCurrentTime() : 0);
    if (!move) return;
    if ('restart' in move) {
      b?.seek(0);
      return;
    }
    goTo(move.index, -1);
  }, [goTo, navState]);

  useEffect(() => {
    nextRef.current = next;
  }, [next]);
  useEffect(() => {
    prevRef.current = prev;
  }, [prev]);

  useRadioExtend({ current, queue, index, history, liked, context, loopMode });

  useDiscordPresence({ current, isPlaying, position, duration });

  useRemoteCommands({ backendRef, backendReady, current, nextRef, prevRef });

  const seek = useCallback((sec: number) => {
    backendRef.current?.seek(sec);
  }, []);

  const playTrack = useCallback((track: Track, list?: Track[], nextContext?: PlaybackContext | null) => {
    userInteracted.current = true;
    // Tapping a search result plays just that song then flows into radio — not
    // the variant-heavy results list. Other contexts queue their whole list.
    const isSearch = nextContext?.type === 'search';
    const queueList = !isSearch && list && list.length ? list : [track];
    let i = queueList.findIndex((t) => t.id === track.id);
    if (i < 0) i = 0;

    // Tapped track is already known dead: hop to the next playable one in
    // this same list instead of loading a track we know will fail.
    if (isUnavailable(track)) {
      const r = nextPlayable(queueList, Math.max(i, 0), 1, false);
      if (r.index < 0) {
        toast.error(`"${track.title}" is unavailable`);
        return;
      }
      toastSkipped(r.skipped);
      track = queueList[r.index];
      i = r.index;
    }

    // Synchronously start so the user-gesture token survives (React 19 effects
    // are async).
    loadAndPlay(track, true);
    usePlayerStore.setState({
      queue: queueList,
      index: i,
      context: nextContext ?? { type: 'single' },
      // Size of the curated list, before radio extends it.
      baseCount: queueList.length,
      // A new queue invalidates any shuffle snapshot — without this, turning
      // shuffle off later would restore a PREVIOUS list's order. Callers that
      // want a shuffled start (the playlist Shuffle button) set it right after.
      shuffle: false,
      orderBackup: null,
    });
    // loadAndPlay (above) already records a 'load' breadcrumb with track id +
    // source, and the backend's onPlay event records 'play' once it actually
    // starts: logging 'play' here too would be a third, earlier copy of the
    // same transition.
  }, [loadAndPlay]);

  useKeyboardShortcuts({ backendRef });

  // b.play()/b.pause() both fire the backend's onPlay/onPause, which is
  // where the 'play'/'pause' breadcrumbs are recorded (see the events object
  // above): logging here too would double them for every manual toggle.
  const toggle = useCallback(() => {
    userInteracted.current = true;
    const b = backendRef.current;
    if (!current || !b) return;
    if (b.isPaused()) {
      b.play();
    } else {
      b.pause();
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
