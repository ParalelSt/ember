import type { OverlayHandle } from '@/lib/pranks/overlayPlayer';
import type { Track } from '@/types/track';
import type { LoopMode } from '@/stores/usePlayerStore';
import type { QueueOrigin } from '@/lib/autoCache/native';
import type { EqSettings } from './eq';
import type { UnplayableNotice } from './unplayable';

/** Transport commands the OS/remote (lock screen, Bluetooth, media keys) can
 *  invoke. The provider supplies these; a backend wires them to the platform. */
export interface RemoteCommands {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
}

/** What a backend can tell the provider about a failure, beyond "it failed". */
export interface AudioErrorInfo {
  /** False when web audio would hit the same wall: the HOST could not deliver
   *  the song (it refused, or it went quiet), rather than this engine being
   *  unable to play bytes it did receive. Swapping engines then costs the whole
   *  session its OS media keys and makes the listener wait twice for the same
   *  answer. Absent means "try it", which is what every backend but the native
   *  one has always meant. */
  canRetryOnWebAudio?: boolean;
  /** Android only: the song that was playing when the native player failed
   *  (it has already moved on by itself by the time this arrives). */
  trackId?: string | null;
  /** Android only: the app build reports failed songs itself, with the
   *  host's reason (`onUnplayable`), so the page need not ask. */
  nativeExplains?: boolean;
}

/** Backend → provider callbacks. The backend owns the player; it reports state
 *  changes up so the provider can update the store / drive the UI. */
export interface AudioBackendEvents {
  onTime: (sec: number) => void; // playback position (web: timeupdate ~4Hz, plus seek/restore)
  onDuration: (sec: number) => void; // duration known/changed
  onEnded: () => void; // track finished → provider decides next
  onPlay: () => void; // actually playing
  onPause: () => void; // paused/stalled
  onError: (info?: AudioErrorInfo) => void; // load/playback failed
  /** Queue-owning backends only (Android): the native player moved to another
   *  item on its own (auto-advance, a skip from the car). */
  onQueueIndex?: (index: number) => void;
  /** Queue-owning backends only: the native side built a new queue (a tap in
   *  the car, native radio, the car's Shuffle button reordering it). The
   *  provider mirrors it; it must NOT push it back. `shuffle` is whether
   *  native's queue is shuffled now (app builds from before it leave it out). */
  onQueueReplaced?: (tracks: Track[], index: number, info?: { shuffle?: boolean }) => void;
  /** Queue-owning backends only: shuffle was turned on or off outside the
   *  app (the car's or the notification's Shuffle button). Native reorders
   *  its queue itself; the new order arrives as onQueueReplaced. `initial`:
   *  native was already shuffled when this page started, so the queue the
   *  page has is the shuffled one (no way back here; native keeps it). */
  onShuffle?: (on: boolean, info?: { initial?: boolean }) => void;
  /** Queue-owning backends only: the loop mode was changed outside the app
   *  (the Repeat button in the car or the notification). */
  onLoopMode?: (mode: LoopMode) => void;
  /** Queue-owning backends only (Android): songs the native player could not
   *  play and what it did about each (skipped, stopped, gave up), with the
   *  host's reason. Several at once are the ones that failed while the app
   *  was in the background, held by native until it came back. */
  onUnplayable?: (notices: UnplayableNotice[]) => void;
}

export interface LoadOptions {
  autoplay: boolean;
  /** Resume position in seconds (0 = from start). */
  startAt?: number;
  /** Set to the track id when the auto cache holds this track
   *  (CacheAdapter.has). An engine that keeps its own cache (the desktop Rust
   *  engine) opens the cached copy by this key and keeps `url` as the
   *  fallback; engines that play a URL the adapter already resolved (web
   *  audio and a blob: URL) ignore it. */
  cacheKey?: string;
}

/** A prank sound played by the native engine beside the music. */
export interface NativeOverlayOptions {
  /** 0..1, a share of the music's own level (native keeps it relative). */
  volume: number;
  /** The music's multiplier while the sound plays (1 = no duck). */
  duckTo: number;
  maxSec: number;
}

export interface AudioBackend {
  /** Point at a new stream URL (already apiUrl-resolved) and optionally start it. */
  load(url: string, opts: LoadOptions): void;
  /** Resume-aware: if the player died in the background, reload + resume. */
  play(): void;
  pause(): void;
  /** Pause and release the current source (null-track / clear). */
  stop(): void;
  seek(sec: number): void;
  /** v in 0..1. gain > 1 is party-mode boost (web: Web Audio; native may clamp).
   *  normGain is the current song's volume normalization, a linear multiplier
   *  (lib/playback/normalization; 1 = unchanged), applied after the volume
   *  curve. A boost (> 1) goes past full volume only where the engine can
   *  amplify (the desktop engine, a web audio graph that is already built);
   *  the server holds every boost under the song's true peak, so it never
   *  clips. rampMs > 0 fades to a new normGain instead of jumping (the gain
   *  changed mid-song); the slider and party gain always apply at once.
   *  The Android engine ignores normGain: it moves between songs natively,
   *  where a per-song level set from here would land on the wrong song. It
   *  normalizes by itself instead (setNormalize). */
  setVolume(v: number, opts?: { gain?: number; normGain?: number; rampMs?: number }): void;
  /** Queue-owning backends only (Android): volume normalization on or off.
   *  The engine looks up and applies each song's gain itself, as it moves
   *  between songs. Absent (or a no-op on an older app build) elsewhere. */
  setNormalize?(enabled: boolean): void;
  /** The equalizer (lib/playback/eq): on or off and the five band gains.
   *  Web audio builds its filter graph the first time it is switched on;
   *  the desktop engine and the Android player filter natively and keep it
   *  across songs themselves. Optional: an engine without one (or an older
   *  app build, which ignores the call) plays unequalized. */
  setEq?(eq: EqSettings): void;
  /** Lock-screen / notification metadata. web → MediaMetadata; native → OS.
   *  `localArtSrc` overrides `track.artworkUrl` when a downloaded copy has its
   *  own local art (already convertFileSrc-resolved by the caller). */
  setMetadata(track: Track | null, localArtSrc?: string | null): void;
  /** Wire OS/remote transport buttons to app actions. web → MediaSession. */
  setRemoteCommands(cmds: RemoteCommands): void;
  /** Current playback position in seconds (0 if unknown). */
  getCurrentTime(): number;
  /** Current track duration in seconds (0 if unknown). */
  getDuration(): number;
  isPaused(): boolean;
  /** Has the current track been fully downloaded (buffered to its end)?
   *  null = this engine cannot tell. The auto cache waits for true (or, on
   *  null, for a fallback play time) before it downloads anything else, so a
   *  prefetch never competes with the song the listener is waiting on.
   *  Optional: absent reads as null. */
  getBufferedToEnd?(): boolean | null;
  /** True while a load/seek-restore is settling — callers must not persist
   *  position during this window (the element reports transient values). */
  isTransitioning(): boolean;
  /** Queue-owning backends only. Hands the whole queue over; the backend diffs
   *  it against what it has so an append never restarts playback.
   *  `startSec` is where a song that has to start does start (a cold start
   *  restoring the saved queue); a song already playing keeps its place. */
  setQueue?(tracks: Track[], index: number, play: boolean, origin?: QueueOrigin, startSec?: number): void;
  /** Queue-owning backends only: the native player decides what is next. */
  next?(): void;
  prev?(): void;
  /** Queue-owning backends only: the native player repeats by itself, so it
   *  has to be told the loop mode. */
  setLoop?(mode: LoopMode): void;
  /** Queue-owning backends only: the shuffle button. The queue itself is
   *  reordered here and handed over with setQueue; native only keeps the
   *  flag (the car's Shuffle button shows it) and `order`, the song ids from
   *  before shuffling, so the car can turn it off again. `restore` (off
   *  only): this page never had that order (the car shuffled before it
   *  opened), so native puts its queue back itself. */
  setShuffle?(on: boolean, order?: string[], restore?: boolean): void;
  /** Android engine on an app build that has the native overlay (absent on
   *  older builds): a prank sound beside the music, ducked and restored
   *  natively so it works with the screen off. */
  playOverlay?(url: string, opts: NativeOverlayOptions): OverlayHandle;
  stopOverlay?(): void;
  /** Playback speed with the pitch kept (the tab page's practice speed).
   *  Web audio only for now: engines
   *  without it (desktop native, Android Media3) play at full speed and the
   *  page hides its speed control. Optional: absent means unsupported. */
  setRate?(rate: number): void;
  /** Web audio only: the page's own audio element, which Safari can send to
   *  an AirPlay speaker or TV as it is (lib/cast/controller). */
  mediaElement?(): HTMLMediaElement | null;
  /** Web audio in a browser with HTMLMediaElement.setSinkId (Chrome on a
   *  computer): the output device the sound goes to, '' for the system
   *  default (lib/outputs). Rejects when the browser refuses the device.
   *  Absent elsewhere: other engines pick their output natively. */
  setOutputDevice?(deviceId: string): Promise<void>;
  /** The device setOutputDevice last applied ('' = the system default). */
  outputDevice?(): string;
  /** Tear down listeners / native resources. */
  destroy(): void;
}

/** Factory: receives the event callbacks, returns a backend instance. */
export type CreateAudioBackend = (events: AudioBackendEvents) => AudioBackend;
