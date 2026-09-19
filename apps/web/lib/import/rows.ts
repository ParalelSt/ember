/** The rows of a playlist while its import is shown: the playlist's real
 *  tracks interleaved, in source order, with a placeholder for every song
 *  that is still being matched, needs a look, or was not found. Pure. */

import type { Track } from '@/types/track';
import type { ImportItem } from '@/lib/import/types';
import type { JobStatus } from '@/lib/import/jobState';

export type ImportRow =
  | { kind: 'track'; key: string; track: Track; item: ImportItem | null }
  | { kind: 'pending'; key: string; item: ImportItem; next: boolean }
  | { kind: 'review' | 'missing'; key: string; item: ImportItem };

export function importRows(items: ImportItem[], tracks: Track[], status: JobStatus): ImportRow[] {
  const byVideo = new Map<string, Track>();
  for (const t of tracks) if (!byVideo.has(t.sourceId)) byVideo.set(t.sourceId, t);
  const used = new Set<string>();
  const rows: ImportRow[] = [];
  const running = status === 'running' || status === 'queued';
  let nextMarked = false;

  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    if (item.status === 'accepted' || item.status === 'resolved') {
      const t = item.videoId ? byVideo.get(item.videoId) : undefined;
      // Removed from the playlist by hand, or the same song twice in the
      // source: shown once.
      if (!t || used.has(t.id)) continue;
      used.add(t.id);
      rows.push({ kind: 'track', key: t.id, track: t, item });
    } else if (item.status === 'pending') {
      // A stopped import will not match the rest.
      if (status === 'cancelled' || status === 'done') continue;
      rows.push({ kind: 'pending', key: item.id, item, next: running && !nextMarked });
      nextMarked = true;
    } else if (item.status === 'review' || item.status === 'missing') {
      rows.push({ kind: item.status, key: item.id, item });
    }
  }
  // Songs added by hand sit after the imported ones.
  for (const t of tracks) {
    if (used.has(t.id)) continue;
    used.add(t.id);
    rows.push({ kind: 'track', key: t.id, track: t, item: null });
  }
  return rows;
}

/** The import item behind a playlist track, for "Wrong song? Re-match". */
export function itemForTrack(items: ImportItem[], track: Track): ImportItem | null {
  return (
    items.find((i) => (i.status === 'accepted' || i.status === 'resolved') && i.videoId === track.sourceId) ?? null
  );
}

/** The review sheet's queue: songs that need a look, then the not-found
 *  ones, each in source order. */
export function reviewQueue(items: ImportItem[]): ImportItem[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return [...sorted.filter((i) => i.status === 'review'), ...sorted.filter((i) => i.status === 'missing')];
}
