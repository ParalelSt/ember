'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore, type LoopMode } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { rankRadioPool } from '@/lib/playback/radio';
import { isUnavailable, nextPlayable } from '@/lib/playback/queueNav';
import type { PlaybackContext, Track } from '@/types/track';

/** Radio mode: at end of queue, fetch recommended (same-style) and extend.
 *  Artist context drifts to other artists once the catalog runs out; survivors
 *  re-ranked by the user's personal play count.
 *
 *  The ranking itself (variant blocking, artist drift, front load, weave) is
 *  pure: see lib/playback/radio. What stays here is the fetch, the
 *  fetching-for guard, the breadcrumbs and the queue write. */
export function useRadioExtend({
  current,
  queue,
  index,
  history,
  liked,
  context,
  loopMode,
  onExtended,
}: {
  current: Track | null;
  queue: Track[];
  index: number;
  history: Track[];
  liked: Track[];
  context: PlaybackContext | null;
  loopMode: LoopMode;
  /** Every finished fetch, with how many songs it added (0 when it failed or
   *  found nothing new; not called for an answer that arrived too late).
   *  The provider uses it to move on from a dead song that was waiting for
   *  radio to find it a successor. */
  onExtended?: (added: number, forTrackId: string) => void;
}) {
  /** Seed track a fetch is already in flight for, so a re-render cannot pull
   *  the same recommendations twice. */
  const fetchingRadioFor = useRef<string | null>(null);

  useEffect(() => {
    if (!current?.sourceId) return;
    // Loop-all wraps the queue instead of extending it, so don't pull in radio.
    // Reactive (not getState): when the user turns loop OFF the effect must
    // re-run, otherwise a 1-track queue that skipped extension while looping
    // stays 1 track forever: un-skippable, looping "even with the toggle off".
    if (loopMode === 'all') return;
    // Hosting a live carlist session: the queue is exactly what the group
    // added, so no radio extension.
    if (useSessionStore.getState().hostingSessionId) return;
    // Extend when nothing PLAYABLE is left after this song: the last song,
    // or a tail of songs found unavailable (greyed in the queue). Radio
    // songs that turn out dead used to leave the queue with nothing to go
    // to, and the music stopped on them with no word.
    if (index < 0 || nextPlayable(queue, index + 1, 1, false).index >= 0) return;
    if (fetchingRadioFor.current === current.id) return;
    fetchingRadioFor.current = current.id;
    const currentId = current.id;
    // Seeded by the last song that can play: a dead video makes a poor seed
    // (YouTube Music may not know it any more).
    let seedAt = index;
    while (seedAt > 0 && isUnavailable(queue[seedAt])) seedAt--;
    const seedTrack = queue[seedAt]?.sourceId ? queue[seedAt] : current;
    const currentSourceId = seedTrack.sourceId;
    const activeContext = context;
    // Snapshot of the queue this fetch was requested for, so a response that
    // lands after the user has moved on (new queue, different current track)
    // can be told apart from one that still applies.
    const requestQueueIds = queue.map((t) => t.id);

    // Cleared the moment the answer is in, before anything below writes the
    // queue: a change that lands in between (a song flagged dead) must be
    // able to ask again. Clearing it later, in a finally, let that change
    // slip past the guard, and the dead song sat there with nothing after it.
    const done = () => { if (fetchingRadioFor.current === currentId) fetchingRadioFor.current = null; };
    api.getRecommended(currentSourceId).then(({ tracks }) => {
      done();
      const state = usePlayerStore.getState();
      const stillCurrent = state.queue[state.index]?.id === currentId;
      const sameQueue =
        state.queue.length === requestQueueIds.length &&
        state.queue.every((t, i) => t.id === requestQueueIds[i]);
      if (!stillCurrent || !sameQueue) {
        logger.breadcrumb('radio', 'stale-skip', {
          context: activeContext?.type ?? 'single',
          seed: currentSourceId,
        });
        return;
      }
      const merged = rankRadioPool({
        // Never a song the queue already knows is dead (the server filters
        // what it knows; this is what this device found out).
        pool: tracks.filter((t) => !isUnavailable(t)),
        queue,
        current,
        history,
        liked,
        context: activeContext,
      });
      logger.breadcrumb('radio', 'extend', {
        context: activeContext?.type ?? 'single',
        seed: currentSourceId,
        recs: tracks.length,
        added: merged.length,
      });
      if (merged.length > 0) {
        // Keep the shuffle snapshot in step with the real queue. Without this,
        // radio tracks appended while shuffle is on are missing from
        // orderBackup, so turning shuffle off would silently DROP them.
        usePlayerStore.setState((st) => ({
          queue: [...st.queue, ...merged],
          orderBackup: st.orderBackup ? [...st.orderBackup, ...merged] : null,
        }));
      }
      onExtended?.(merged.length, currentId);
    }).catch((e) => {
      done();
      logger.error('radio', 'recommended fetch failed', { context: activeContext?.type ?? 'single', seed: currentSourceId }, e as Error);
      onExtended?.(0, currentId);
    });
    // onExtended is a latest-callback the provider keeps stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.sourceId, index, queue, history, liked, context, loopMode]);
}
