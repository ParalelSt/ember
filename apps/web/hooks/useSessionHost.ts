'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import type { SessionState } from '@/types/track';

const COMMAND_POLL_MS = 2500;

/** Host-side mirror for a live carlist session. Mounted by the session page
 *  when this device is the host:
 *  - appends session tracks into the local player queue (idempotent id-diff,
 *    so refreshes and repeat polls are safe; a track added twice to one
 *    session queues once on the host — accepted v1 limitation);
 *  - consumes guest commands (skip → player.next());
 *  - publishes the playing index so guests' screens track it;
 *  - claims/clears the hosting flag (which also suppresses radio auto-extend).
 *  Autoplay note: the very first track still needs one tap on the host phone
 *  (browser gesture policy) — after that, advances are automatic. */
export function useSessionHost(state: SessionState | undefined) {
  const { next, index } = usePlayer();
  const setHostingSessionId = useSessionStore((s) => s.setHostingSessionId);

  const isActiveHost = !!state && state.session.isHost && state.session.active;
  const sessionId = state?.session.id ?? null;

  // Latest next() for the command interval without re-registering it.
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  // Claim / clear the hosting flag.
  useEffect(() => {
    if (!state) return;
    if (state.session.isHost) {
      setHostingSessionId(state.session.active ? state.session.id : null);
    }
  }, [state, setHostingSessionId]);

  // Mirror: any session track missing from the player queue gets appended
  // (in session order). Runs on every poll result; no-ops when in sync.
  useEffect(() => {
    if (!isActiveHost || !state) return;
    const store = usePlayerStore.getState();
    const have = new Set(store.queue.map((t) => t.id));
    const missing = state.queue.map((q) => q.track).filter((t) => !have.has(t.id));
    if (missing.length === 0) return;
    const queue = [...store.queue, ...missing];
    usePlayerStore.setState(store.queue.length === 0 ? { queue, index: 0 } : { queue });
    logger.breadcrumb('session', 'host-queue-append', { added: missing.length, total: queue.length });
  }, [isActiveHost, state]);

  // Guest commands: poll + execute.
  useEffect(() => {
    if (!isActiveHost || !sessionId) return;
    const timer = setInterval(() => {
      api
        .consumeSessionCommands(sessionId)
        .then(({ commands }) => {
          for (const c of commands) {
            if (c.type === 'skip') {
              logger.breadcrumb('session', 'skip-executed', { sessionId });
              nextRef.current();
            }
          }
        })
        .catch(() => {});
    }, COMMAND_POLL_MS);
    return () => clearInterval(timer);
  }, [isActiveHost, sessionId]);

  // Publish the playing position (guests highlight the right row).
  useEffect(() => {
    if (!isActiveHost || !sessionId || index < 0) return;
    api.publishSessionNow(sessionId, index).catch(() => {});
  }, [isActiveHost, sessionId, index]);
}
