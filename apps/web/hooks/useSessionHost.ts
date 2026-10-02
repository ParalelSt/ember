'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { mergeIntoPlayerQueue, sessionIndexFor } from '@/lib/carlist';
import type { SessionState } from '@/types/track';

const COMMAND_POLL_MS = 2500;

/** Host-side mirror for a live carlist session. Mounted by the session page
 *  when this device is the host:
 *  - puts session tracks into the local player queue, each after the song it
 *    follows in the session, so Play next lands right after the current song
 *    (idempotent id-diff, so refreshes and repeat polls are safe; a track
 *    added twice to one session queues once on the host, an accepted v1
 *    limitation);
 *  - consumes guest commands (skip → player.next());
 *  - publishes the playing session row so guests' screens track it;
 *  - claims/clears the hosting flag (which also suppresses radio auto-extend).
 *  Autoplay note: the very first track still needs one tap on the host phone
 *  (browser gesture policy) — after that, advances are automatic. */
export function useSessionHost(state: SessionState | undefined) {
  const { next, current } = usePlayer();
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

  // Mirror: any session track missing from the player queue goes in after
  // the song it follows in the session. Runs on every poll result; no-ops
  // when in sync.
  useEffect(() => {
    if (!isActiveHost || !state) return;
    const store = usePlayerStore.getState();
    const merged = mergeIntoPlayerQueue(store.queue, store.index, state.queue.map((q) => q.track));
    if (!merged) return;
    usePlayerStore.setState(merged);
    logger.breadcrumb('session', 'host-queue-merge', {
      added: merged.queue.length - store.queue.length,
      total: merged.queue.length,
    });
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

  // Publish which session row is playing (guests highlight it, and Play
  // next lands after it). The player's queue can hold songs from before the
  // carlist, so the row is found by the playing song, not the player index.
  const serverNow = state?.session.nowIndex ?? 0;
  const playingRow =
    isActiveHost && state ? sessionIndexFor(state.queue.map((q) => q.track.id), current?.id, serverNow) : -1;
  const lastPublished = useRef<number | null>(null);
  useEffect(() => {
    if (!isActiveHost || !sessionId || playingRow < 0) return;
    if (playingRow === lastPublished.current) return;
    lastPublished.current = playingRow;
    if (playingRow === serverNow) return;
    api.publishSessionNow(sessionId, playingRow).catch(() => {
      lastPublished.current = null;
    });
  }, [isActiveHost, sessionId, playingRow, serverNow]);
}
