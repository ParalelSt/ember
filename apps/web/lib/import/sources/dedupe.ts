/** The same song twice in one source.
 *
 *  Exports repeat themselves: a song liked from a single and again from the
 *  album, the same row in two playlists a tool merged. Duplicates are
 *  dropped before the job exists, so `total` is honest and the runner does
 *  not search for the same song twice.
 *
 *  Two songs are the same when they carry the same `uri`, or, with no uri,
 *  when their title and first artist normalise to the same thing. The
 *  normalising is the matcher's own (lib/import/score.ts), so "Song (feat.
 *  X)" and "Song" agree here exactly as they do when a candidate is scored.
 *  Pure. */

import { normalizeArtist, normalizeTitle } from '@/lib/import/score';
import type { TransferItem } from '@/lib/import/sources/types';

export function songKeyOf(item: TransferItem): string {
  if (item.uri) return `uri:${item.uri}`;
  return `${normalizeTitle(item.title)}|${normalizeArtist(item.artists[0] ?? item.artist ?? '')}`;
}

/** The list with repeats taken out, positions renumbered from 0, and how
 *  many went. The first of a repeated pair wins, so source order holds. */
export function dedupeItems(items: TransferItem[]): { items: TransferItem[]; dropped: number } {
  const seen = new Set<string>();
  const out: TransferItem[] = [];
  for (const item of items) {
    const key = songKeyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, position: out.length });
  }
  return { items: out, dropped: items.length - out.length };
}
