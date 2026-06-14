import type { Track } from '@/types/track';

/** Transport commands the OS/remote (lock screen, Bluetooth, media keys) can
 *  invoke. The provider supplies these; a backend wires them to the platform. */
export interface RemoteCommands {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
}

/** Backend → provider callbacks. The backend owns the player; it reports state
 *  changes up so the provider can update the store / drive the UI. */
export interface AudioBackendEvents {
  onTime: (sec: number) => void; // playback position (web: timeupdate ~4Hz, plus seek/restore)
  onDuration: (sec: number) => void; // duration known/changed
  onEnded: () => void; // track finished → provider decides next
  onPlay: () => void; // actually playing
  onPause: () => void; // paused/stalled
  onError: () => void; // load/playback failed
}

export interface LoadOptions {
  autoplay: boolean;
  /** Resume position in seconds (0 = from start). */
  startAt?: number;
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
  /** v in 0..1. gain > 1 is party-mode boost (web: Web Audio; native may clamp). */
  setVolume(v: number, opts?: { gain?: number }): void;
  /** Lock-screen / notification metadata. web → MediaMetadata; native → OS. */
  setMetadata(track: Track | null): void;
  /** Wire OS/remote transport buttons to app actions. web → MediaSession. */
  setRemoteCommands(cmds: RemoteCommands): void;
  /** Current playback position in seconds (0 if unknown). */
  getCurrentTime(): number;
  /** Current track duration in seconds (0 if unknown). */
  getDuration(): number;
  isPaused(): boolean;
  /** True while a load/seek-restore is settling — callers must not persist
   *  position during this window (the element reports transient values). */
  isTransitioning(): boolean;
  /** Tear down listeners / native resources. */
  destroy(): void;
}

/** Factory: receives the event callbacks, returns a backend instance. */
export type CreateAudioBackend = (events: AudioBackendEvents) => AudioBackend;
