import type { Shell } from './detectShell';
import type { AudioBackend, CreateAudioBackend } from './types';

/** Which shells have a real native AudioBackend we can ACTUALLY reach.
 *
 *  tauri → only when Tauri's IPC bridge is exposed to this page. The desktop
 *  app loads the Ember server as a REMOTE origin, and Tauri only grants such an
 *  origin IPC access when the capability whitelists it. If that's missing (or
 *  the bridge hasn't been injected), every invoke() fails and the Rust engine
 *  produces SILENCE with no error the user can see. Probing here means we fall
 *  back to the web <audio> backend and the app still plays music — just without
 *  OS media keys. Never trade working audio for a feature.
 *
 *  capacitor → handled by createCapacitorBackend, not here. */
export function nativeBackendReady(shell: Shell): boolean {
  if (shell !== 'tauri') return false;
  if (typeof window === 'undefined') return false;
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
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
