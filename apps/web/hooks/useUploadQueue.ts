'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QK } from '@/hooks/useLibrary';
import { createUploadQueue, type UploadQueue } from '@/lib/uploadQueue';
import { uploadSongXhr } from '@/lib/uploadXhr';
import type { Track } from '@/types/track';

/** One queue for the whole app, so songs keep going (and the card shows
 *  them again) when the member leaves Settings > Uploads and comes back. */
let shared: UploadQueue<Track> | null = null;

export function sharedUploadQueue(): UploadQueue<Track> {
  shared ??= createUploadQueue<Track>(uploadSongXhr);
  return shared;
}

/** Tests start each case with an empty queue. */
export function resetSharedUploadQueue(): void {
  shared?.cancelAll();
  shared = null;
}

/** The shared queue and its items. Each finished song refreshes the shared
 *  Uploads collection and the member's own list. */
export function useUploadQueue() {
  const queue = sharedUploadQueue();
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const qc = useQueryClient();
  useEffect(
    () =>
      queue.onUploaded(() => {
        void qc.invalidateQueries({ queryKey: QK.uploads });
      }),
    [queue, qc],
  );
  return { queue, items };
}
