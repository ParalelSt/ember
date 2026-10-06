'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { createClient } from '@/lib/pocketbase/client';
import { toPrankRow } from '@/lib/pranks/decide';
import type { PrankAck, PrankRow } from '@/lib/pranks/types';

/** Inbox poll: fast while music plays (a sound only lands then), slow
 *  otherwise (a ping still arrives well inside its 45 s window). */
export const POLL_PLAYING_MS = 2_500;
export const POLL_IDLE_MS = 10_000;

/** Realtime link. Returns an unsubscribe. `onConnect` fires on every
 *  (re)connect, `onDisconnect` whenever the link drops. */
export type PrankSubscribe = (
  userId: string,
  onRow: (row: PrankRow) => void,
  onConnect: () => void,
  onDisconnect: () => void,
) => () => void;

/** What `receive` hands back for a prank that runs for a while (a sound):
 *  the first acknowledgement now, and a follow-up (`done`) that is sent only
 *  after the first has landed, since the server takes the moves in order. */
export interface PrankReceipt {
  ack: PrankAck;
  then: Promise<PrankAck | null>;
}

/** What `receive` returns to leave a prank pending and be offered it again
 *  on the next fetch (a sound, while nothing plays on this device). */
export type PrankLater = 'later';

export interface PrankInboxDeps {
  fetchInbox: () => Promise<PrankRow[]>;
  ack: (id: string, body: PrankAck) => Promise<unknown>;
  /** Null: poll only. */
  subscribe: PrankSubscribe | null;
}

/** PocketBase realtime on `pranks`, filtered to this user's pending rows
 *  (the collection's view rule is the real fence). */
const realtimeSubscribe: PrankSubscribe = (userId, onRow, onConnect, onDisconnect) => {
  const pb = createClient();
  let closed = false;
  const offs: (() => Promise<void>)[] = [];
  const keep = (p: Promise<() => Promise<void>>) =>
    p.then((off) => (closed ? void off().catch(() => {}) : void offs.push(off))).catch(() => {});

  pb.realtime.onDisconnect = () => onDisconnect();
  keep(pb.realtime.subscribe('PB_CONNECT', () => onConnect()));
  keep(
    pb.collection('pranks').subscribe(
      '*',
      (e) => {
        if (e.action !== 'create') return;
        const row = toPrankRow(e.record);
        if (row) onRow(row);
      },
      { filter: pb.filter('target = {:id} && status = "pending"', { id: userId }) },
    ),
  );
  return () => {
    closed = true;
    for (const off of offs) void off().catch(() => {});
    onDisconnect();
  };
};

/** The realtime link only where it streams. Under `next start` the /pb
 *  rewrite is gzip-compressed and SSE never arrives (tests/pranks-realtime.spike.mjs),
 *  so the poll is the primary path and realtime is an opt-in upgrade for a
 *  host that serves /pb uncompressed: NEXT_PUBLIC_PRANKS_REALTIME=1. */
export const defaultPrankInboxDeps: PrankInboxDeps = {
  fetchInbox: () => api.pranks.inbox().then((r) => r.pranks),
  ack: (id, body) => api.pranks.ack(id, body),
  subscribe: process.env.NEXT_PUBLIC_PRANKS_REALTIME === '1' ? realtimeSubscribe : null,
};

/** Receives pranks for the signed-in user: poll (always while the realtime
 *  link is down, or while a prank waits here for later), realtime when
 *  available, a catch-up fetch on every (re)connect. Each prank is handed to
 *  `receive` once; whatever it returns is sent back as the acknowledgement
 *  (null sends nothing; a receipt sends its ack, then its follow-up;
 *  'later' sends nothing and offers it again next time). Silent by design:
 *  nothing here toasts, logs or throws. */
export function usePrankInbox({
  userId,
  isPlaying,
  receive,
  deps = defaultPrankInboxDeps,
}: {
  userId: string | null;
  isPlaying: boolean;
  receive: (
    row: PrankRow,
  ) => PrankAck | PrankReceipt | PrankLater | null | Promise<PrankAck | PrankReceipt | PrankLater | null>;
  deps?: PrankInboxDeps;
}) {
  const receiveRef = useRef(receive);
  useEffect(() => {
    receiveRef.current = receive;
  }, [receive]);

  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  const seen = useRef(new Set<string>());
  /** Left for later: offered again on the next fetch. */
  const waiting = useRef(new Set<string>());
  const live = useRef(false);

  const handleRef = useRef((row: PrankRow) => {
    if (seen.current.has(row.id)) return;
    seen.current.add(row.id);
    Promise.resolve()
      .then(() => receiveRef.current(row))
      .then(async (result) => {
        if (result === 'later') {
          seen.current.delete(row.id);
          waiting.current.add(row.id);
          return;
        }
        if (!result) return;
        if (!('ack' in result)) {
          await depsRef.current.ack(row.id, result);
          return;
        }
        await depsRef.current.ack(row.id, result.ack);
        const followUp = await result.then;
        if (followUp) await depsRef.current.ack(row.id, followUp);
      })
      .catch(() => {});
  });

  const catchUp = useRef(() =>
    depsRef.current
      .fetchInbox()
      .then((rows) => {
        // Whatever is still waiting comes back in this fetch; one that
        // expired or went to another device does not.
        waiting.current.clear();
        rows.forEach((r) => handleRef.current(r));
      })
      .catch(() => {}),
  );

  // A different account on this device starts with a clean slate.
  useEffect(() => {
    seen.current = new Set();
    waiting.current = new Set();
  }, [userId]);

  useEffect(() => {
    const subscribe = depsRef.current.subscribe;
    if (!userId || !subscribe) return;
    const off = subscribe(
      userId,
      (row) => handleRef.current(row),
      () => {
        live.current = true;
        void catchUp.current();
      },
      () => {
        live.current = false;
      },
    );
    return () => {
      off();
      live.current = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const every = isPlaying ? POLL_PLAYING_MS : POLL_IDLE_MS;
    const tick = async () => {
      if (!live.current || waiting.current.size) await catchUp.current();
      if (!stopped) timer = setTimeout(tick, every);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [userId, isPlaying]);
}
