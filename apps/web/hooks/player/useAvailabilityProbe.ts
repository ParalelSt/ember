'use client';

import { useCallback, useEffect, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { flagQueueUnavailable, usePlayerStore } from '@/stores/usePlayerStore';
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
 *  track that turns out to be dead gets the skip message instead, never both.
 *
 *  Offline there is nobody to ask: the failure is the connection, not the
 *  track. The probe then flags nothing and hands the track to
 *  `onOfflineRef` (PlayerProvider: play the next song with a copy on this
 *  device, or stop with the offline badge and come back to this one when the
 *  connection returns), or calls plain Next without one. Asking anyway used to end in
 *  "Couldn't load" for every song in the queue. */
export function useAvailabilityProbe(
  nextRef: RefObject<() => void>,
  onOfflineRef?: RefObject<((failed: { id: string }) => void) | null>,
  signedIn = true,
  /** Filled with the list refresh below, for the songs the provider flags
   *  itself (the Android player's reports, a prefetch answered 410). */
  refreshRef?: RefObject<() => void>,
) {
  const qc = useQueryClient();

  /** The lists that draw the unavailable badge (liked, history, playlists),
   *  refetched after a flag. Also handed out through `refreshRef`. */
  const refreshLists = useCallback(() => {
    qc.invalidateQueries({ queryKey: QK.likes });
    qc.invalidateQueries({ queryKey: QK.history });
    qc.invalidateQueries({ queryKey: ['playlist'] });
  }, [qc]);

  /** `onDead`, when given, decides what happens to a dead track that is
   *  still the one playing (the provider says why and moves on, or stops
   *  after too many in a row); without it, Next is pressed. */
  const probe = useCallback((
    onStillPlayable?: (track: { id: string; title: string }) => void,
    onDead?: (track: { id: string; title: string }, reason: string | null) => void,
  ) => {
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

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      logger.breadcrumb('playback', 'probe-skipped-offline', { trackId: erroredId });
      if (onOfflineRef?.current) onOfflineRef.current(cur);
      else nextRef.current();
      return;
    }

    api.getTrackAvailability(erroredId).then(({ unavailable, reason }) => {
      if (!unavailable) {
        onStillPlayable?.(cur);
        return;
      }
      const before = usePlayerStore.getState();
      // The request outlived its track: the user may have skipped away (or
      // the track left the queue) while it was in flight. Flag the entry by
      // id wherever it now sits, but only auto-advance if it is still the
      // one actually playing, otherwise this stale answer would fire an
      // unrequested extra skip from wherever they are now.
      if (!flagQueueUnavailable(erroredId, reason)) return;
      refreshLists();
      logger.breadcrumb('playback', 'unavailable', { trackId: erroredId, reason });
      if (before.queue[before.index]?.id !== erroredId) return;
      if (onDead) onDead(cur, reason);
      else nextRef.current();
    }).catch(() => {
      // The server could not be asked either. The track is not known to be
      // dead, so it is the same "it just would not load" case: say so rather
      // than leaving the player silent with no explanation.
      onStillPlayable?.(cur);
    });
  }, [refreshLists, nextRef, onOfflineRef, signedIn]);

  useEffect(() => {
    if (refreshRef) refreshRef.current = refreshLists;
  }, [refreshRef, refreshLists]);

  return probe;
}
