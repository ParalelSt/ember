/** What each playlist's sidebar row says about its import. Pure. */

import type { ImportJob } from '@/lib/import/types';

export type NavImportState =
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'paused'; done: number; total: number }
  | { kind: 'failed' }
  | { kind: 'review'; count: number };

/** One state per playlist, from its newest import (jobs come newest
 *  first). A finished import with nothing left to check shows nothing. */
export function navImportStates(jobs: ImportJob[]): Record<string, NavImportState> {
  const out: Record<string, NavImportState> = {};
  for (const j of jobs) {
    if (!j.playlistId || out[j.playlistId] || j.dismissed) continue;
    let state: NavImportState | null = null;
    if (j.status === 'queued' || j.status === 'running') state = { kind: 'importing', done: j.cursor, total: j.total };
    else if (j.status === 'paused') {
      state = j.retryAt ? { kind: 'importing', done: j.cursor, total: j.total } : { kind: 'paused', done: j.cursor, total: j.total };
    } else if (j.status === 'failed') state = { kind: 'failed' };
    else if (j.review > 0) state = { kind: 'review', count: j.review };
    if (state) out[j.playlistId] = state;
  }
  return out;
}
