import type { ServerLogEntry } from '../logger/types';
import { fingerprint } from './fingerprint';

export interface OccurrenceHistory {
  count: number;
  firstSeen: number | null;
  lastSeen: number | null;
}

/** How often each fingerprint has occurred in a window of server entries,
 *  and the span it occurred over ("first time we've seen this" versus "this
 *  has been happening for a week"). Walks the entry list a single time. */
export function historyFor(entries: ServerLogEntry[], fps: string[]): Map<string, OccurrenceHistory> {
  const result = new Map<string, OccurrenceHistory>();
  for (const fp of fps) result.set(fp, { count: 0, firstSeen: null, lastSeen: null });

  for (const e of entries) {
    const fp = fingerprint(e);
    const bucket = result.get(fp);
    if (!bucket) continue;
    bucket.count++;
    if (bucket.firstSeen === null || e.ts < bucket.firstSeen) bucket.firstSeen = e.ts;
    if (bucket.lastSeen === null || e.ts > bucket.lastSeen) bucket.lastSeen = e.ts;
  }
  return result;
}
