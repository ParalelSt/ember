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
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { localArtFor, localSrcFor } from '@/lib/offlineNative';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteRecordPlay, useQueryHistory, useQueryLikes } from '@/hooks/useLibrary';
import { useQueryLyrics } from '@/hooks/useLyrics';
import { apiUrl } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { detectShell } from '@/lib/playback/detectShell';
import { chooseDuration } from '@/lib/playback/chooseDuration';
import { isUnavailable, nextIndex, nextPlayable, nextPlayableOffline, prevIndex } from '@/lib/playback/queueNav';
import { useAvailabilityProbe } from '@/hooks/player/useAvailabilityProbe';
import { useAutoCache } from '@/hooks/player/useAutoCache';
import type { BackendKind } from '@/lib/autoCache/select';
import type { QueueOrigin } from '@/lib/autoCache/native';
import { useDiscordPresence } from '@/hooks/player/useDiscordPresence';
import { usePositionPersistence } from '@/hooks/player/usePositionPersistence';
import { useRadioExtend } from '@/hooks/player/useRadioExtend';
import { useKeyboardShortcuts } from '@/hooks/player/useKeyboardShortcuts';
import { useRemoteCommands } from '@/hooks/player/useRemoteCommands';
import { useTrackGain } from '@/hooks/player/useTrackGain';
import { dbToLinear } from '@/lib/playback/normalization';
import { createWebBackend } from '@/lib/playback/webBackend';
import { createCapacitorBackend } from '@/lib/playback/capacitorBackend';
import { createNativeBackend, nativeBackendReady } from '@/lib/playback/nativeBridge';
import { createTauriBackend } from '@/lib/playback/tauriBackend';
import { createAndroidBackend, androidPluginPresent } from '@/lib/playback/androidBackend';
import type { AudioBackend, AudioBackendEvents, AudioErrorInfo } from '@/lib/playback/types';
import type { PlaybackContext, Track } from '@/types/track';
import { musicLevel } from '@/lib/pranks/mix';
import { PrankReceiver } from './PrankReceiver';

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
  /** Playback speed, pitch kept (the tab page's practice speed). 1 as
   *  recorded. */
  rate: number;
  setRate: (rate: number) => void;
  /** The engine playing now can change speed (web audio; not the desktop's
   *  native engine or Android's Media3 yet). */
  canSetRate: boolean;
}

const PlayerContext = createContext<PlayerControls | null>(null);

/** How far short of a track's known length an `ended` event may land and still
 *  count as the song finishing. Anything earlier is the engine's source giving
 *  out, not a finished song. Generous, because backends report the last second
 *  of a track coarsely (the web element's timeupdate fires a few times a
 *  second, and a desktop decoder's duration is a second opinion at best). */
const ENDED_SLACK_SEC = 5;

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

/** The one toast of an offline stall (see goTo). */
export const OFFLINE_STALL_TOAST = "Offline: no more cached songs. Playback resumes when you're back online.";

/** Ids with a downloaded copy the current engine can play offline: browser
 *  storage (blob: URLs) and the Android plugin's files. */
function pinnedIds(): Set<string> {
  const { webFiles, trackFiles } = useOfflineStore.getState();
  return new Set([...Object.keys(webFiles), ...Object.keys(trackFiles)]);
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
  const backendKindRef = useRef<BackendKind>('web');
  /** The engine in use, as state, so the auto cache can pick the adapter
   *  that goes with it: set at startup, and again when a broken desktop
   *  engine falls back to web audio (which cannot open the Rust cache). */
  const [initialKind, setInitialKind] = useState<BackendKind | null>(null);
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
  /** Track id whose loaded src is an auto-cached copy (a blob: URL from the
   *  cache adapter). A copy that will not play is dropped from the cache. */
  const cacheSrcTrackRef = useRef<string | null>(null);
  /** The offline stall toast is shown once per offline spell, not per skip. */
  const offlineToastShownRef = useRef(false);
  const eventsRef = useRef<AudioBackendEvents | null>(null);
  /** When the store's queue/index last changed BECAUSE the native player said
   *  so. The queue-push effect and the load-on-id-change effect both skip
   *  changes inside this window, or a car tap would bounce straight back. A
   *  timestamp rather than a flag: not every native change fires both effects,
   *  and a flag nobody consumed would swallow the next real change. */
  const nativeChangeAt = useRef(0);
  const fromNative = () => Date.now() - nativeChangeAt.current < 300;
  /** The queue last handed to the native Android player, so the queue-push
   *  effect does not send the same list a second time. */
  const sentQueueRef = useRef<Track[] | null>(null);
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
  // panel has data ready when opened (React Query caches it). The lookup
  // needs a session: signed out it only collected 401s (bughunt V5).
  useQueryLyrics(current, !!user);

  const partyVolume = useSettingsStore((s) => s.partyVolume);
  const muted = usePlayerStore((s) => s.muted);
  const loopMode = usePlayerStore((s) => s.loopMode);

  // Volume normalization: the current song's measured gain as a multiplier
  // for setVolume. Not on the native Android engine, which moves between
  // songs by itself and applies the gain there (setNormalize, below).
  const normalizeVolume = useSettingsStore((s) => s.normalizeVolume);
  const normalizeOn = normalizeVolume && initialKind !== null && initialKind !== 'android';
  const trackGainDb = useTrackGain(current?.id, queue[index + 1]?.id, normalizeOn);
  const normGain = normalizeOn ? dbToLinear(trackGainDb) : 1;
  const normGainRef = useRef(1);

  // The stored playhead: who owns it, when it is written, where a track
  // resumes. Called here, before the backend is built, because the backend's
  // events report positions and persist on pause.
  const positions = usePositionPersistence({ backendRef, backendReady });

  // Stable callback, so the backend's one-time event object can close over
  // it: asks the server whether a failing track has actually died.
  const offlineFailRef = useRef<((failed: { id: string }) => void) | null>(null);
  const probeAvailability = useAvailabilityProbe(nextRef, offlineFailRef, !!user);

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
      onQueueIndex: (i) => {
        // Native advanced or the car skipped. Mirror it; do NOT load anything.
        const st = usePlayerStore.getState();
        if (i >= 0 && i < st.queue.length && i !== st.index) {
          nativeChangeAt.current = Date.now();
          // Native is playing it now, so it counts as loaded.
          loadedTrackRef.current = st.queue[i].id;
          setIndex(i);
        }
      },
      onQueueReplaced: (tracks, i) => {
        nativeChangeAt.current = Date.now();
        const at = Math.max(0, Math.min(i, tracks.length - 1));
        loadedTrackRef.current = tracks[at]?.id ?? null;
        const st = usePlayerStore.getState();
        // Native radio only adds songs after ours: the playlist this came
        // from and the shuffle (with its way back) still hold.
        const appended = tracks.length > st.queue.length && st.queue.every((t, k) => t.id === tracks[k]?.id);
        if (appended) {
          const added = tracks.slice(st.queue.length);
          usePlayerStore.setState({
            queue: tracks,
            index: at,
            orderBackup: st.orderBackup ? [...st.orderBackup, ...added] : null,
          });
          return;
        }
        // A new list (a tap in the car): not this page's shuffle either, or
        // the shuffle button would show on with nothing to undo.
        usePlayerStore.setState({
          queue: tracks,
          index: at,
          context: null,
          shuffle: false,
          orderBackup: null,
        });
      },
      onLoopMode: (mode) => {
        // The car or the notification's Repeat button. Mirror it; the loop
        // effect then finds native already there and sends nothing back.
        if (usePlayerStore.getState().loopMode !== mode) usePlayerStore.getState().setLoopMode(mode);
      },
      onEnded: () => {
        // The native Android player advances by itself; `ended` only means the
        // whole queue ran out, and there is nothing to load from here.
        if (backendKindRef.current === 'android') return;
        // Read the latest loop state at fire time so a stale closure can't lock
        // us into the wrong mode.
        const state = usePlayerStore.getState();
        const cur = state.queue[state.index];
        // The backend's own clock is the freshest reading; the store's is the
        // last one it reported. The higher of the two, because mistaking a
        // real end for a failure would cost the listener their auto-advance.
        const pos = Math.max(backendRef.current?.getCurrentTime() ?? 0, state.position);
        const dur = state.duration;
        logger.breadcrumb('playback', 'ended', {
          trackId: cur?.id ?? null,
          position: Math.round(pos),
          duration: Math.round(dur),
        });
        // An "ended" that arrives while the playhead is still well short of
        // the song's known length did not come from a finished song: it came
        // from a source that gave out (a stream that died, a seek the decoder
        // could not service). Advancing the queue there IS the skip the
        // listener sees, so run the error path instead: it keeps the song and
        // retries it. Without a known duration there is nothing to compare
        // against, so the event is taken at face value.
        if (dur > 0 && pos < dur - ENDED_SLACK_SEC) {
          logger.error('playback', 'the engine ended a track early', {
            trackId: cur?.id ?? null,
            position: Math.round(pos),
            duration: Math.round(dur),
            backend: backendKindRef.current,
          });
          handleError();
          return;
        }
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
      // Both are idempotent, which both branches needed for their own reason:
      // the web backend reports play twice (the 'play' event and the play()
      // promise), and the Android backend re-asserts play/pause on every native
      // state event so the store converges on what the car is actually doing.
      // Only a real flip writes the flag or leaves a breadcrumb.
      onPlay: () => {
        const cur = usePlayerStore.getState();
        if (cur.isPlaying) return;
        setIsPlaying(true);
        logger.breadcrumb('playback', 'play', { trackId: cur.queue[cur.index]?.id ?? null });
      },
      onPause: () => {
        // Always persist (a pause is the moment the playhead is worth keeping,
        // even when the store already says paused because an error path got
        // there first); only the flip and its breadcrumb are guarded.
        positions.persistRef.current();
        const cur = usePlayerStore.getState();
        if (!cur.isPlaying) return;
        setIsPlaying(false);
        logger.breadcrumb('playback', 'pause', { trackId: cur.queue[cur.index]?.id ?? null });
      },
      onError: (info) => handleError(info),
    };
    // The error path, named so `onEnded` can run it for an "ended" that is
    // really a failure (see there). Declared after `events` and hoisted, so
    // both callbacks close over the same function.
    function handleError(info?: AudioErrorInfo) {
      {
        // A native engine that can't play is worse than no native engine:
        // retry this track on web audio before giving up on it. Unless the
        // engine says the HOST could not deliver the song, in which case web
        // audio would ask the same server the same question, the listener
        // would wait through a second failure, and the session would lose its
        // OS media keys over one bad track.
        if (
          backendKindRef.current === 'tauri-native'
          && !fellBackRef.current
          && info?.canRetryOnWebAudio !== false
        ) {
          fallbackToWebAudioRef.current?.('audio backend reported an error');
          return;
        }
        // The Android player owns playback and keeps going (or advances) after
        // a bad item; forcing "paused" here left the bar stuck until reload.
        if (backendKindRef.current === 'android') return;
        // A downloaded file that will not play (deleted under us, or a
        // half-written one) must not cost the song: stream it instead, once,
        // from where the playhead was. Offline there is nothing to fall back
        // to, so the normal error handling stands.
        const st = usePlayerStore.getState();
        const track = st.queue[st.index];
        // An auto-cached copy that will not play (evicted under us, or a bad
        // file) is dropped, so neither the player nor the offline skip counts
        // on it again. The stream fallback below still applies.
        if (track && cacheSrcTrackRef.current === track.id) {
          cacheSrcTrackRef.current = null;
          logger.error('playback', 'cached copy would not play, dropping it', { trackId: track.id });
          void useAutoCacheStore.getState().adapter.evict([track.id])
            .then(() => useAutoCacheStore.getState().refresh());
        }
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
        // Stop, but keep the playhead where the listener was. Resetting it to
        // 0 meant that pressing play again, or clicking the song again, began
        // the track from the start: the "the same song starts over" half of
        // the report. The stored playhead already belongs to this track (see
        // usePositionPersistence), so a retry resumes from it.
        setIsPlaying(false);
        // Was the track itself the problem? The probe asks the server, flags
        // the queue entry if so, and skips on. See useAvailabilityProbe.
        // If the server has nothing against it, the song simply would not
        // load, and the listener gets told that instead of watching a player
        // that has quietly stopped.
        probeAvailability((track) => toast.error(`Couldn't load "${track.title}"`));
      }
    }
    // Per-shell backend: tauri has a native engine (Part 5); capacitor keeps
    // web audio but mirrors the session to the native media-session plugin
    // (Part 3a — foreground service = background playback); plain web uses the
    // bare <audio> backend.
    const shell = detectShell();
    let create = createWebBackend;
    if (shell === 'capacitor') {
      // Newer APKs carry the native Media3 player (Android Auto); older ones
      // only have the media-session plugin. Both keep working against this server.
      create = androidPluginPresent() ? createAndroidBackend : createCapacitorBackend;
    } else if (shell !== 'web' && nativeBackendReady(shell)) {
      create = shell === 'tauri' ? createTauriBackend : createNativeBackend;
    }
    eventsRef.current = events;
    backendKindRef.current = create === createWebBackend ? 'web'
      : create === createCapacitorBackend ? 'capacitor'
      : create === createAndroidBackend ? 'android'
      : create === createTauriBackend ? 'tauri-native' : 'native-stub';
    backendRef.current = create(events);
    setInitialKind(backendKindRef.current);
    // lib/logger has no ref to backendKindRef, so the provider is the one
    // place that pushes it into the context envelope (see logger.setContext).
    logger.setContext({ backendKind: backendKindRef.current });
    // Visible in devtools; tells you instantly whether the desktop app is on
    // the Rust engine or fell back to web audio.
    logger.breadcrumb('playback', 'backend selected', {
      shell,
      backend: create === createWebBackend ? 'web'
        : create === createCapacitorBackend ? 'capacitor'
        : create === createAndroidBackend ? 'android'
        : create === createTauriBackend ? 'tauri-native' : 'native-stub',
    });
    setBackendReady(true);
    return () => {
      backendRef.current?.destroy();
      backendRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Volume curve + party gain. Muted forces 0 (stored value preserved). A
  // ducking prank sound scales the music down while it plays (duck < 1);
  // every engine gets that through the same setVolume.
  const [duck, setDuck] = useState(1);
  const duckRef = useRef(1);
  useEffect(() => {
    duckRef.current = duck;
    normGainRef.current = normGain;
    const b = backendRef.current;
    if (!b) return;
    b.setVolume(musicLevel(volume, muted, duck), { gain: partyVolume ? 2 : 1, normGain });
  }, [backendReady, volume, partyVolume, muted, duck, normGain]);

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
  /** The engine swap itself, for good: the native engine is destroyed and
   *  plain web audio takes over with the current volume. Loads nothing. */
  const swapToWebAudio = useCallback(() => {
    fellBackRef.current = true;
    try { backendRef.current?.destroy(); } catch { /* already broken */ }
    backendRef.current = createWebBackend(eventsRef.current!);
    backendKindRef.current = 'web';
    setInitialKind('web');
    logger.setContext({ backendKind: 'web' });
    // partyVolume lives in the settings store, not the player store.
    const st = usePlayerStore.getState();
    const party = useSettingsStore.getState().partyVolume;
    backendRef.current.setVolume(musicLevel(st.volume, st.muted, duckRef.current), {
      gain: party ? 2 : 1,
      normGain: normGainRef.current,
    });
  }, []);

  const fallbackToWebAudio = useCallback((reason: string) => {
    if (backendKindRef.current === 'web' || fellBackRef.current) return;
    logger.error('playback', 'native audio failed — falling back to web audio', { reason });

    const st0 = usePlayerStore.getState();
    const failing = st0.queue[st0.index];
    const resumeAt = failing ? positions.resumeTargetFor(failing.id) : 0;
    swapToWebAudio();

    const st = usePlayerStore.getState();
    const track = st.queue[st.index];
    if (track) {
      positions.requestStartAt(resumeAt);
      loadAndPlayRef.current?.(track, true);
    }
    // `positions` is a stable object of stable callbacks, so this callback's
    // identity does not change: it is listed to satisfy the deps rule, not
    // because it can ever differ.
  }, [positions, swapToWebAudio]);

  // Load + (optionally) play a track. Must run from a user gesture for autoplay
  // (React 19 effects are async and lose the activation token). The first call
  // restores the persisted position; later calls start fresh (see
  // usePositionPersistence). `next` is the queue about to be set and where it
  // came from, for the native Android player: without it, a tap in a new list
  // was first sent as a one-song queue and then again as the whole list, and
  // the one send it now gets must carry the new list's context and baseCount
  // (the auto cache's loop-all wrap), which the store does not hold yet.
  const loadAndPlay = useCallback((track: Track | null, autoplay: boolean, next?: QueueOrigin & { list: Track[] }) => {
    let b = backendRef.current;
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
    if (backendKindRef.current === 'android' && b.setQueue) {
      // The native player owns the queue: hand it the whole thing and the
      // index to start at. It diffs, so an unchanged queue never restarts.
      let queue = next?.list ?? usePlayerStore.getState().queue;
      let idx = queue.findIndex((t) => t.id === track.id);
      if (idx < 0) { queue = [track]; idx = 0; }
      loadedTrackRef.current = track.id;
      // A song picked or moved to starts from the top: hand the stored
      // playhead to THIS track at 0, so nothing later can resume it at the
      // previous song's timestamp (see usePositionPersistence). The saved
      // queue restored at a cold start (autoplay off) resumes where the
      // listener was instead, as on web and desktop; it used to go back to
      // 0:00 whenever Android had closed the app. Native only applies it
      // when it has to start the song (not when it is already playing it).
      if (autoplay) positions.requestStartAt(0);
      const startSec = positions.startAt(track.id);
      setDuration(chooseDuration(track.durationSec ?? 0, null));
      sentQueueRef.current = queue;
      const origin = next ? { context: next.context, baseCount: next.baseCount } : undefined;
      if (startSec > 0) b.setQueue(queue, idx, autoplay, origin, startSec);
      else if (origin) b.setQueue(queue, idx, autoplay, origin);
      else b.setQueue(queue, idx, autoplay);
      return;
    }
    loadedTrackRef.current = track.id;
    // Hands the stored playhead to this track and returns where it resumes.
    const startAt = positions.startAt(track.id);
    // Same for the length. Without this the slider keeps the PREVIOUS song's
    // duration until the engine volunteers one, which on desktop it often
    // never does.
    setDuration(chooseDuration(track.durationSec ?? 0, null));
    // A browser-storage download is a blob: URL only this page can read. The
    // desktop Rust engine fetches outside the webview, so it keeps streaming
    // online; offline, web audio playing the downloaded copy beats silence.
    const downloads = useOfflineStore.getState();
    const webCopy = downloads.webFiles[track.id] ?? null;
    if (webCopy && backendKindRef.current === 'tauri-native' && !navigator.onLine) {
      logger.breadcrumb('playback', 'offline: web audio for a downloaded copy', { trackId: track.id });
      swapToWebAudio();
      b = backendRef.current!;
    }
    const readsBlobs = backendKindRef.current === 'web' || backendKindRef.current === 'capacitor';
    // A downloaded copy plays even online: instant, and no data used.
    const local = localSrcFor(track, downloads.trackFiles) ?? (readsBlobs ? webCopy : null);
    // Then an auto-cached copy, same reasons. The adapter only hands out a
    // source this engine can load (a blob: URL for web audio); an engine
    // with its own cache (desktop) gets the key and opens the file itself,
    // with the stream URL as its fallback.
    const cache = useAutoCacheStore.getState().adapter;
    const cachedSrc = local ? null : cache.localSrcFor(track.id);
    const cacheKey = !local && cache.has(track.id) ? track.id : undefined;
    localSrcTrackRef.current = local || cachedSrc ? track.id : null;
    cacheSrcTrackRef.current = cachedSrc ? track.id : null;
    // Only a fresh LOCAL load re-arms the one-shot stream fallback; the
    // fallback's own load is not local, so it cannot re-arm itself.
    if (local || cachedSrc) streamFallbackRef.current = null;
    logger.breadcrumb('playback', 'load', {
      trackId: track.id,
      backend: backendKindRef.current,
      source: local ? 'local' : cachedSrc || cacheKey ? 'cache' : 'stream',
    });
    b.load(local ?? cachedSrc ?? apiUrl(track.streamUrl), { autoplay, startAt, ...(cacheKey ? { cacheKey } : {}) });
    // Set metadata in the same synchronous turn so the notification carries
    // across a track boundary (Firefox Android tears it down otherwise).
    // Local art (the same downloaded copy) wins over the remote artworkUrl.
    b.setMetadata(track, localArtFor(track, downloads.artFiles));
  }, [positions, swapToWebAudio]);

  loadAndPlayRef.current = loadAndPlay;
  fallbackToWebAudioRef.current = fallbackToWebAudio;

  // Drives load+autoplay on track changes nobody loaded yet: cold-load
  // hydration of a persisted queue, and index changes that did not go through
  // playTrack/next/prev (those load in the gesture, before the index moves).
  useEffect(() => {
    if (!backendReady) return;
    // A change the native player reported is already playing there; loading
    // it again would restart it (and echo the queue back).
    if (backendKindRef.current === 'android' && fromNative()) return;
    // Already handed to the backend by the gesture that changed the track.
    // Loading it again aborted that load's play(): a pause/play flicker on
    // every change, and two loads (two error toasts) on desktop.
    if (!current || loadedTrackRef.current !== current.id) {
      loadAndPlay(current, userInteracted.current);
    }
    // The native Android player records plays itself (car-initiated ones too).
    if (current && userInteracted.current && user && backendKindRef.current !== 'android') recordPlay.mutate(current);
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
  /** Offline with nothing playable ahead. Still playing (a Next pressed
   *  mid-song): the song carries on and only the toast says why nothing
   *  happened. Stopped: a stall, remembered with the song to come back to.
   *  One toast per offline spell, whatever happens. */
  const stallOffline = useCallback((targetId: string | null) => {
    const b = backendRef.current;
    const stopped = !b || b.isPaused();
    logger.breadcrumb('playback', 'offline: nothing cached ahead', { trackId: targetId, stopped });
    if (!offlineToastShownRef.current) {
      offlineToastShownRef.current = true;
      toast(OFFLINE_STALL_TOAST);
    }
    if (stopped) {
      setIsPlaying(false);
      useAutoCacheStore.getState().setStalled(true, targetId);
    }
  }, [setIsPlaying]);

  const goTo = useCallback((target: number, step: 1 | -1, stallId?: string) => {
    const st = usePlayerStore.getState();
    const ac = useAutoCacheStore.getState();
    // Offline, only a track with a copy on this device can play: walk past
    // the rest (not flagged, just out of reach). Nothing left means a stall
    // (see stallOffline); the connection coming back loads the song we
    // stopped at (see the effect below).
    if (!ac.online && backendKindRef.current !== 'android') {
      const cached = new Set(ac.adapter.entries().keys());
      const r = nextPlayableOffline(st.queue, target, step, st.loopMode === 'all', cached, pinnedIds());
      toastSkipped(r.skipped);
      if (r.index < 0) {
        stallOffline(stallId ?? r.uncached[0]?.id ?? null);
        return;
      }
      if (ac.offlineStalled) ac.setStalled(false);
      if (r.uncached.length > 0) {
        logger.breadcrumb('playback', 'offline: skipped uncached', { count: r.uncached.length });
      }
      loadAndPlay(st.queue[r.index], true);
      setIndex(r.index);
      return;
    }
    const r = nextPlayable(st.queue, target, step, st.loopMode === 'all');
    toastSkipped(r.skipped);
    if (r.index < 0) {
      toast.error('Nothing left to play');
      return;
    }
    loadAndPlay(st.queue[r.index], true);
    setIndex(r.index);
  }, [loadAndPlay, setIndex, stallOffline]);

  // The current song failed while offline (useAvailabilityProbe): move to the
  // next song with a local copy; with none, stall on the failed song itself,
  // since that is the one to load again when the connection returns.
  useEffect(() => {
    offlineFailRef.current = (failed) => {
      const st = usePlayerStore.getState();
      const move = nextIndex({ queue: st.queue, index: st.index, loopMode: st.loopMode, context: st.context, baseCount: st.baseCount });
      if (!move) stallOffline(failed.id);
      else goTo(move.index, 1, failed.id);
    };
  }, [goTo, stallOffline]);

  useAutoCache({ backendRef, backendKind: initialKind });

  // Back online: the badge clears, prefetching resumes (useAutoCache), and a
  // stall is undone by loading the song we stopped at, PAUSED: autoplay is
  // refused without a gesture, and a song starting on its own after minutes
  // of silence would be a surprise anyway. The listener presses play.
  useEffect(() => useAutoCacheStore.subscribe((s, prev) => {
    if (s.online === prev.online || !s.online) return;
    offlineToastShownRef.current = false;
    if (!s.offlineStalled) return;
    const id = s.stalledTrackId;
    s.setStalled(false);
    toast('Back online', { duration: 2500 });
    if (!id || backendKindRef.current === 'android') return;
    const st = usePlayerStore.getState();
    const i = st.queue.findIndex((t) => t.id === id);
    if (i < 0) return;
    logger.breadcrumb('playback', 'online: loading the stalled song paused', { trackId: id });
    // The stalled song may be the one that failed to load: its failed load
    // must not count as "already loaded".
    loadedTrackRef.current = null;
    loadAndPlay(st.queue[i], false);
    setIndex(i);
  }), [loadAndPlay, setIndex]);

  const next = useCallback(() => {
    userInteracted.current = true;
    // The native player owns the queue (and keeps playing when this WebView is
    // gone), so it decides what comes next: loop, radio tail and all.
    if (backendKindRef.current === 'android') { backendRef.current?.next?.(); return; }
    const move = nextIndex(navState());
    if (!move) {
      // The end of the queue, offline: radio cannot extend it, so say why
      // the music stopped.
      if (!useAutoCacheStore.getState().online) stallOffline(null);
      return;
    }
    // goTo, not loadAndPlay: it walks past anything unavailable before it
    // can become "current" even for an instant.
    goTo(move.index, 1);
  }, [goTo, navState, stallOffline]);

  const prev = useCallback(() => {
    userInteracted.current = true;
    if (backendKindRef.current === 'android') { backendRef.current?.prev?.(); return; }
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

  // Queue-owning backend (Android): whenever the store's queue changes from
  // THIS side (radio append, add to queue), hand the new queue over. Changes
  // that arrived from native are flagged and skipped, or they would bounce,
  // and so is a queue playTrack has just handed over itself.
  useEffect(() => {
    // Not before the first load: the page's opening render would send the
    // saved queue here, and then the cold-start load sends it again.
    if (!backendReady || backendKindRef.current !== 'android' || fromNative()) return;
    const b = backendRef.current;
    if (!b?.setQueue || !current || queue === sentQueueRef.current) return;
    sentQueueRef.current = queue;
    b.setQueue(queue, index, usePlayerStore.getState().isPlaying);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // The native Android player normalizes by itself (it moves between songs
  // without this page), so it only needs the setting.
  useEffect(() => {
    backendRef.current?.setNormalize?.(normalizeVolume);
  }, [backendReady, initialKind, normalizeVolume]);

  // The native Android player repeats (or stops at the end) by itself, so
  // it has to be told the loop mode. Other backends have no setLoop: the
  // provider applies the mode itself in onEnded and next/prev.
  useEffect(() => {
    backendRef.current?.setLoop?.(loopMode);
  }, [backendReady, loopMode]);

  // The Android backend's setRemoteCommands/setMetadata are no-ops: the native
  // Media3 session owns the lock screen and the car, so this registers nothing
  // twice.
  useRemoteCommands({ backendRef, backendReady, current, nextRef, prevRef });

  const seek = useCallback((sec: number) => {
    backendRef.current?.seek(sec);
  }, []);

  // Practice speed (the tab page). Kept here so a swap to web audio (a
  // native engine that failed) carries it over.
  const [rate, setRateState] = useState(1);
  const setRate = useCallback((next: number) => {
    const r = Number.isFinite(next) && next > 0 ? next : 1;
    setRateState(r);
    backendRef.current?.setRate?.(r);
  }, []);
  useEffect(() => {
    backendRef.current?.setRate?.(rate);
    // Only on a new engine: setRate itself applies every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendReady, initialKind]);
  const canSetRate = initialKind === 'web' || initialKind === 'capacitor';

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
    const context: PlaybackContext = nextContext ?? { type: 'single' };
    // Size of the curated list, before radio extends it.
    const baseCount = queueList.length;
    loadAndPlay(track, true, { list: queueList, context, baseCount });
    usePlayerStore.setState({
      queue: queueList,
      index: i,
      context,
      baseCount,
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
      playTrack, toggle, next, prev, seek, setVolume, rate, setRate, canSetRate,
    }),
    [current, isPlaying, position, duration, volume, queue, index, context, playTrack, toggle, next, prev, seek, setVolume, rate, setRate, canSetRate],
  );

  // Pranks (admin only, never announced) sit beside the tree rather than in
  // this component, so their store reads don't re-render the whole player.
  return (
    <PlayerContext.Provider value={value}>
      <PrankReceiver backendRef={backendRef} engineRef={backendKindRef} onDuck={setDuck} />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
