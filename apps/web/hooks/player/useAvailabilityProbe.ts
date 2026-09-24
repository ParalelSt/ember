'use client';

import { useCallback, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { QK } from '@/hooks/useLibrary';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger/client';
import { isUnavailable } from '@/lib/playback/queueNav';

/** The engine failed on the current track for a reason other than "we
 *  already knew it was dead". Ask the server whether it has just become
 *  dead (a removed YouTube video failing mid-stream) and, if so, flag it in
 *  the queue, refresh the lists that render the flag, and move on rather
 *  than sitting on a track that will never play.
 *
 *  Returns a stable `probe()` the backend's `onError` can call. Nothing
 *  happens when there is no current track, or when it is already flagged
 *  (that failure was expected).
 *
 *  `onStillPlayable` runs for the other answer: the server has nothing against
 *  this track, so it failed for some passing reason (a download the host could
 *  not make, a stream that stopped) and the listener is owed a word about the
 *  song they are looking at. It is the ONLY place that says so, precisely so a
 *  track that turns out to be dead gets the skip message instead, never both. */
export function useAvailabilityProbe(nextRef: RefObject<() => void>, signedIn = true) {
  const qc = useQueryClient();

  return useCallback((onStillPlayable?: (track: { title: string }) => void) => {
    const st = usePlayerStore.getState();
    const cur = st.queue[st.index];
    if (!cur || isUnavailable(cur)) return;
    const erroredId = cur.id;
    // Signed out (a shared /track page) the server won't answer: it just
    // would not load (bughunt V5).
    if (!signedIn) {
      onStillPlayable?.(cur);
      return;
    }

    api.getTrackAvailability(erroredId).then(({ unavailable, reason }) => {
      if (!unavailable) {
        onStillPlayable?.(cur);
        return;
      }
      const at = new Date().toISOString();
      const before = usePlayerStore.getState();
      // The request outlived its track: the user may have skipped away (or
      // the track left the queue) while it was in flight. Flag the entry by
      // id wherever it now sits, but only auto-advance if it is still the
      // one actually playing, otherwise this stale answer would fire an
      // unrequested extra skip from wherever they are now.
      if (!before.queue.some((t) => t.id === erroredId)) return;
      usePlayerStore.setState((s) => ({
        queue: s.queue.map((t) => (
          t.id === erroredId ? { ...t, unavailableAt: at, unavailableReason: reason } : t
        )),
      }));
      qc.invalidateQueries({ queryKey: QK.likes });
      qc.invalidateQueries({ queryKey: QK.history });
      qc.invalidateQueries({ queryKey: ['playlist'] });
      logger.breadcrumb('playback', 'unavailable', { trackId: erroredId, reason });
      if (before.queue[before.index]?.id === erroredId) nextRef.current();
    }).catch(() => {
      // The server could not be asked either. The track is not known to be
      // dead, so it is the same "it just would not load" case: say so rather
      // than leaving the player silent with no explanation.
      onStillPlayable?.(cur);
    });
  }, [qc, nextRef, signedIn]);
}
