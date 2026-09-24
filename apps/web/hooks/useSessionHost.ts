'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useQuerySession } from '@/hooks/useSession';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import type { SessionState } from '@/types/track';

const COMMAND_POLL_MS = 2500;

/** Answers that mean the session is over for this device: signed out,
 *  not a member (any more), or the session is gone. A network error is
 *  none of these, so an offline blip keeps the host role. */
const GONE_STATUSES = new Set([401, 403, 404, 410]);

/** Host-side mirror for a live carlist session. Mounted once by the app
 *  shell (SessionHostBridge), so it keeps running while the host browses
 *  other pages. Active while `hostingSessionId` is set:
 *  - appends session tracks into the local player queue (idempotent id-diff,
 *    so refreshes and repeat polls are safe; a track added twice to one
 *    session queues once on the host — accepted v1 limitation);
 *  - consumes guest commands (skip → player.next());
 *  - publishes which SESSION row is playing so guests' screens track it;
 *  - drops the hosting flag (which also suppresses radio auto-extend) once
 *    the session has ended, is gone, or is no longer ours.
 *  Autoplay note: the very first track still needs one tap on the host phone
 *  (browser gesture policy) — after that, advances are automatic. */
export function useSessionHost() {
  const { next } = usePlayer();
  const currentId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const hostingId = useSessionStore((s) => s.hostingSessionId);
  const { data: state, error } = useQuerySession(hostingId);

  const isActiveHost =
    !!state && state.session.id === hostingId && state.session.isHost && state.session.active;
  const sessionId = isActiveHost ? hostingId : null;

  // Latest next() for the command interval without re-registering it.
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  // Release the hosting flag once the session is over for us.
  useEffect(() => {
    if (!hostingId) return;
    const ended = !!state && state.session.id === hostingId && (!state.session.active || !state.session.isHost);
    const status = (error as { status?: number } | null)?.status;
    if (ended || (status !== undefined && GONE_STATUSES.has(status))) {
      logger.breadcrumb('session', 'host-released', { sessionId: hostingId, status: status ?? 'ended' });
      // Only if it still names this session (a new one may have been claimed).
      if (useSessionStore.getState().hostingSessionId === hostingId) {
        useSessionStore.getState().setHostingSessionId(null);
      }
    }
  }, [hostingId, state, error]);

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
    if (!sessionId) return;
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
  }, [sessionId]);

  // Publish the playing position (guests highlight the right row). Guests
  // index the session queue, not this player's queue, so translate: the row
  // of the playing song (its first, as a repeat queues once here). A song
  // from outside the session publishes nothing.
  const nowIndex = state?.session.nowIndex;
  const row = state && currentId ? state.queue.findIndex((q) => q.track.id === currentId) : -1;
  useEffect(() => {
    if (!sessionId || row < 0 || row === nowIndex) return;
    api.publishSessionNow(sessionId, row).catch(() => {});
  }, [sessionId, row, nowIndex]);
}

/** Start hosting on this device. Whatever is playing keeps playing, but the
 *  rest of the old queue goes: the group's songs come next, and a guest's
 *  Skip only ever skips the song in front of everyone. */
export function startHosting(sessionId: string) {
  const { queue, index } = usePlayerStore.getState();
  const playing = queue[index];
  usePlayerStore.setState({
    queue: playing ? [playing] : [],
    index: playing ? 0 : -1,
    baseCount: 0,
    shuffle: false,
    orderBackup: null,
  });
  useSessionStore.getState().setHostingSessionId(sessionId);
}

/** Session page: a host looking at their own live session claims the host
 *  role on this device (e.g. after a sign-in on a fresh device). Clearing is
 *  useSessionHost's job, so leaving the page never drops the role. */
export function useClaimSessionHost(state: SessionState | undefined) {
  const setHostingSessionId = useSessionStore((s) => s.setHostingSessionId);
  useEffect(() => {
    if (state?.session.isHost && state.session.active) setHostingSessionId(state.session.id);
  }, [state, setHostingSessionId]);
}
