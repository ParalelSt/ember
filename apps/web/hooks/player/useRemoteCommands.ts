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
  engine = null,
  current,
  nextRef,
  prevRef,
}: {
  backendRef: RefObject<AudioBackend | null>;
  backendReady: boolean;
  /** Which engine is live. A change (the desktop engine swapped for web
   *  audio) builds a new backend, which needs the commands wired again:
   *  without it the media keys went dead for the rest of the session. */
  engine?: string | null;
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
    // The engine in the ref at the moment of the press: while casting it is
    // the cast engine, and the local one that registered these is stopped.
    b.setRemoteCommands({
      play: () => backendRef.current?.play(),
      pause: () => backendRef.current?.pause(),
      next: () => nextRef.current(),
      prev: () => prevRef.current(),
      seek: (sec) => backendRef.current?.seek(sec),
    });
    // The three refs are stable ref objects: only a backend being built
    // (backendReady, then an engine swap) re-registers the commands.
  }, [backendReady, engine, backendRef, nextRef, prevRef]);
}
