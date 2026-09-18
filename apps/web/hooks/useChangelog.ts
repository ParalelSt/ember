'use client';

import { useMemo } from 'react';
import { CHANGELOG, computeNewIds, type ChangelogEntry } from '@/lib/changelog';
import { useChangelogStore } from '@/stores/useChangelogStore';

export interface UseChangelog {
  entries: ChangelogEntry[];
  /** Ids that carry a New tag right now (empty while hidden or loading). */
  newIds: ReadonlySet<string>;
  hasNew: boolean;
  hideNew: boolean;
  setHideNew: (hide: boolean) => Promise<void>;
  markAllRead: () => Promise<void>;
  loaded: boolean;
}

/** Everything the "What's new" UI needs, in one place. The store is loaded
 *  by AuthProvider once there is a session. */
export function useChangelog(): UseChangelog {
  const seenVersion = useChangelogStore((s) => s.seenVersion);
  const hideNew = useChangelogStore((s) => s.hideNew);
  const loaded = useChangelogStore((s) => s.loaded);
  const setHideNew = useChangelogStore((s) => s.setHideNew);
  const markAllRead = useChangelogStore((s) => s.markAllRead);

  const newIds = useMemo(() => new Set(computeNewIds(CHANGELOG, seenVersion, hideNew)), [seenVersion, hideNew]);

  return { entries: CHANGELOG, newIds, hasNew: newIds.size > 0, hideNew, setHideNew, markAllRead, loaded };
}
