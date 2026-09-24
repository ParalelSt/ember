import type { OverlayHandle } from '@/lib/pranks/overlayPlayer';
import type { Track } from '@/types/track';
import type { LoopMode } from '@/stores/usePlayerStore';
import type { QueueOrigin } from '@/lib/autoCache/native';

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
   *  the car, native radio). The provider mirrors it; it must NOT push it back. */
  onQueueReplaced?: (tracks: Track[], index: number) => void;
  /** Queue-owning backends only: the loop mode was changed outside the app
   *  (the Repeat button in the car or the notification). */
  onLoopMode?: (mode: LoopMode) => void;
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
   *  (lib/playback/normalization; 1 = unchanged). Applied after the volume
   *  curve and never past full volume outside party mode. The Android engine
   *  ignores it: it moves between songs natively, where a per-song level set
   *  from here would land on the wrong song. */
  setVolume(v: number, opts?: { gain?: number; normGain?: number }): void;
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
   *  it against what it has so an append never restarts playback. */
  setQueue?(tracks: Track[], index: number, play: boolean, origin?: QueueOrigin): void;
  /** Queue-owning backends only: the native player decides what is next. */
  next?(): void;
  prev?(): void;
  /** Queue-owning backends only: the native player repeats by itself, so it
   *  has to be told the loop mode. */
  setLoop?(mode: LoopMode): void;
  /** Android engine on an app build that has the native overlay (absent on
   *  older builds): a prank sound beside the music, ducked and restored
   *  natively so it works with the screen off. */
  playOverlay?(url: string, opts: NativeOverlayOptions): OverlayHandle;
  stopOverlay?(): void;
  /** Tear down listeners / native resources. */
  destroy(): void;
}

/** Factory: receives the event callbacks, returns a backend instance. */
export type CreateAudioBackend = (events: AudioBackendEvents) => AudioBackend;
