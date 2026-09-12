import type { ServerLogEntry } from '../logger/types';
import { fingerprint } from './fingerprint';

export interface OccurrenceHistory {
  count: number;
  firstSeen: number | null;
  lastSeen: number | null;
}

/** How often a specific fingerprint has occurred in a window of server
 *  entries, and the span it occurred over. Used to tell "first time we've
 *  seen this" from "this has been happening for a week". */
export function countOccurrences(entries: ServerLogEntry[], fp: string): OccurrenceHistory {
  let count = 0;
  let firstSeen: number | null = null;
  let lastSeen: number | null = null;
  for (const e of entries) {
    if (fingerprint(e) !== fp) continue;
    count++;
    if (firstSeen === null || e.ts < firstSeen) firstSeen = e.ts;
    if (lastSeen === null || e.ts > lastSeen) lastSeen = e.ts;
  }
  return { count, firstSeen, lastSeen };
}

/** Same as countOccurrences but for many fingerprints at once, walking the
 *  entry list a single time instead of once per fingerprint. */
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
