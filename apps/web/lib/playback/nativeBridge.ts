import type { AudioBackend, CreateAudioBackend } from './types';

/** Flip to true once a real native audio bridge is implemented (Parts 3/5).
 *  While false, PlayerProvider keeps every shell (Tauri/Capacitor) on the web
 *  <audio> backend — selecting this no-op stub would make playback silent. */
export const NATIVE_BACKEND_READY = false;

/** No-op backend used until a native shell provides a real bridge (Parts 3/5).
 *  Every method is a guarded no-op; reads return neutral values. The `events`
 *  argument is accepted (and intentionally unused) so the signature matches
 *  CreateAudioBackend and the real implementation can drop in later. */
export const createNativeBackend: CreateAudioBackend = (events) => {
  void events;
  const backend: AudioBackend = {
    load: () => {},
    play: () => {},
    pause: () => {},
    stop: () => {},
    seek: () => {},
    setVolume: () => {},
    setMetadata: () => {},
    setRemoteCommands: () => {},
    getCurrentTime: () => 0,
    getDuration: () => 0,
    isPaused: () => true,
    isTransitioning: () => false,
    destroy: () => {},
  };
  return backend;
};
