import type { Shell } from './detectShell';
import type { AudioBackend, CreateAudioBackend } from './types';

/** Which shells have a real native AudioBackend implemented today.
 *  tauri → yes (Part 5). capacitor → not yet (Part 3); falls back to web. */
export function nativeBackendReady(shell: Shell): boolean {
  return shell === 'tauri';
}

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
