'use client';

import { useEffect, type RefObject } from 'react';
import type { AudioBackend } from '@/lib/playback/types';
import { localArtFor } from '@/lib/offlineNative';
import { useOfflineStore } from '@/stores/useOfflineStore';
import type { Track } from '@/types/track';

/** OS / remote transport wiring: the lock screen, the notification, Bluetooth
 *  buttons and media keys.
 *
 *  The platform detail lives in the backends (web: MediaSession; capacitor:
 *  the native media-session plugin that also keeps the foreground service
 *  alive; tauri: the Rust engine's own controls), so all this hook does is
 *  hand the current commands and metadata down. */
export function useRemoteCommands({
  backendRef,
  backendReady,
  current,
  nextRef,
  prevRef,
}: {
  backendRef: RefObject<AudioBackend | null>;
  backendReady: boolean;
  current: Track | null;
  nextRef: RefObject<() => void>;
  prevRef: RefObject<() => void>;
}) {
  const artFiles = useOfflineStore((s) => s.artFiles);

  // Media metadata backstop for track changes that don't flow through
  // loadAndPlay (hydration on cold load). loadAndPlay sets it synchronously.
  useEffect(() => {
    backendRef.current?.setMetadata(current, current ? localArtFor(current, artFiles) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, artFiles]);

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
    // The three refs are stable ref objects, so backendReady is still the only
    // thing that can re-register the commands, exactly as before.
  }, [backendReady, backendRef, nextRef, prevRef]);
}
