'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore, type LoopMode } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { rankRadioPool } from '@/lib/playback/radio';
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
}: {
  current: Track | null;
  queue: Track[];
  index: number;
  history: Track[];
  liked: Track[];
  context: PlaybackContext | null;
  loopMode: LoopMode;
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
    if (index !== queue.length - 1) return;
    if (fetchingRadioFor.current === current.id) return;
    fetchingRadioFor.current = current.id;
    const currentId = current.id;
    const currentSourceId = current.sourceId;
    const activeContext = context;

    api.getRecommended(currentSourceId).then(({ tracks }) => {
      const merged = rankRadioPool({
        pool: tracks,
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
    }).catch((e) => {
      logger.error('radio', 'recommended fetch failed', { context: activeContext?.type ?? 'single', seed: currentSourceId }, e as Error);
    }).finally(() => {
      if (fetchingRadioFor.current === currentId) fetchingRadioFor.current = null;
    });
  }, [current?.id, current?.sourceId, index, queue, history, liked, context, loopMode]);
}
