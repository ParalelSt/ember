/** The background import loop (docs/imports.md, section 5).
 *
 *  One job at a time: claim the oldest queued job, then walk its items from
 *  the cursor in batches of 8. Each batch is matched (one `player.py match`
 *  process), its accepted tracks are added to the playlist at their source
 *  positions, the items are saved and the cursor moves on. A crash between
 *  those steps only repeats one batch: re-adding a track is a no-op.
 *
 *  YouTube Music answers rapid searches with 503, so batches are paced, and
 *  a failed batch waits 5 s, 20 s, 60 s before trying again; after that the
 *  job is paused until someone presses Retry.
 *
 *  Everything outside the loop (PocketBase, the matcher, the clock) comes in
 *  through `RunnerDeps`, so the unit tests drive it with fakes. */

import type { Track } from '@/types/track';
import type { ImportCandidate, ImportSourceKind, MatchResult, SourceItem } from '@/lib/import/types';
import {
  BACKOFF_MS,
  BATCH_SIZE,
  PACE_MS,
  STALE_MS,
  playlistPosition,
  transition,
  type JobStatus,
} from '@/lib/import/jobState';

export interface RunnerJob {
  id: string;
  status: JobStatus;
  cursor: number;
  total: number;
  source: ImportSourceKind;
  playlistId: string;
}

export interface PendingItem {
  id: string;
  position: number;
  source: SourceItem;
  /** Filled in advance for a YouTube Music playlist: its own tracks, so no
   *  search is needed. Empty for Spotify items. */
  candidates: ImportCandidate[];
}

export interface ItemResult {
  itemId: string;
  position: number;
  status: 'accepted' | 'review' | 'missing';
  videoId: string | null;
  confidence: number | null;
  candidates: ImportCandidate[];
}

export interface JobCounts {
  accepted: number;
  review: number;
  missing: number;
}

export interface JobPatch extends Partial<JobCounts> {
  status?: JobStatus;
  cursor?: number;
  error?: string;
  /** Epoch ms, or null to clear. */
  retryAt?: number | null;
  heartbeat?: number;
}

export interface JobStore {
  /** Put jobs whose runner stopped checking in before `staleBefore` back in
   *  the queue. Returns how many. */
  releaseStale(staleBefore: number): Promise<number>;
  /** The oldest queued job, now running and held by `runnerId`; or null. */
  claimNext(runnerId: string, now: number): Promise<RunnerJob | null>;
  getJob(id: string): Promise<RunnerJob | null>;
  updateJob(id: string, patch: JobPatch): Promise<void>;
  /** Pending items from `fromPosition` on, in source order. */
  pendingItems(jobId: string, fromPosition: number, limit: number): Promise<PendingItem[]>;
  saveResults(results: ItemResult[]): Promise<void>;
  /** Add a track at a playlist position. Already there: a no-op. */
  addTrack(playlistId: string, position: number, track: Track): Promise<void>;
  counts(jobId: string): Promise<JobCounts>;
}

export interface RunnerDeps {
  store: JobStore;
  match: (items: SourceItem[]) => Promise<MatchResult[]>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  runnerId: string;
  paceMs?: number;
  backoffMs?: readonly number[];
  staleMs?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export const BUSY_MESSAGE = 'YouTube Music asked Ember to slow down. Trying again shortly.';
export const GAVE_UP_MESSAGE = "YouTube Music isn't answering right now. Press Retry to carry on.";
export const FAILED_MESSAGE = 'The import stopped because of an error. Press Retry to carry on.';

export class ImportRunner {
  private busy = false;
  private again = false;
  /** The job being worked on, for the heartbeat timer. */
  currentJobId: string | null = null;

  constructor(private readonly deps: RunnerDeps) {}

  /** Run queued jobs until none are left. Calling it while a pass is in
   *  progress only asks for one more pass, so there is never a second loop. */
  async tick(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    const { store, now, runnerId } = this.deps;
    try {
      do {
        this.again = false;
        const released = await store.releaseStale(now() - (this.deps.staleMs ?? STALE_MS));
        if (released) this.deps.log?.('released orphaned imports', { released });
        for (;;) {
          const job = await store.claimNext(runnerId, now());
          if (!job) break;
          this.currentJobId = job.id;
          try {
            await this.runJob(job);
          } catch (e) {
            // The store itself failed (PocketBase down or the playlist gone):
            // say so on the job if we still can.
            this.deps.log?.('import job failed', { job: job.id, error: (e as Error).message });
            await store
              .updateJob(job.id, { status: 'failed', error: FAILED_MESSAGE, retryAt: null })
              .catch(() => {});
          } finally {
            this.currentJobId = null;
          }
        }
      } while (this.again);
    } finally {
      this.busy = false;
    }
  }

  async runJob(job: RunnerJob): Promise<void> {
    const { store, sleep, now } = this.deps;
    const backoff = this.deps.backoffMs ?? BACKOFF_MS;
    let failures = 0;
    for (;;) {
      const fresh = await store.getJob(job.id);
      // Cancelled, deleted with its playlist, or handed back to the queue.
      if (!fresh || fresh.status !== 'running') return;

      const items = await store.pendingItems(job.id, fresh.cursor, BATCH_SIZE);
      if (!items.length) {
        const counts = await store.counts(job.id);
        await store.updateJob(job.id, {
          ...counts,
          status: transition('running', 'finish'),
          cursor: fresh.total,
          error: '',
          retryAt: null,
        });
        return;
      }

      let results: ItemResult[];
      const searched = items.some((i) => !i.candidates.length);
      try {
        results = await this.matchBatch(items);
      } catch (e) {
        failures += 1;
        const wait = backoff[failures - 1];
        this.deps.log?.('import batch failed', { job: job.id, failures, error: (e as Error).message });
        if (wait === undefined) {
          await store.updateJob(job.id, {
            status: transition('running', 'give-up'),
            error: GAVE_UP_MESSAGE,
            retryAt: null,
          });
          return;
        }
        await store.updateJob(job.id, {
          status: transition('running', 'backoff'),
          error: BUSY_MESSAGE,
          retryAt: now() + wait,
        });
        await sleep(wait);
        const after = await store.getJob(job.id);
        // Cancelled, or Retry pressed (back to queued) while waiting.
        if (!after || after.status !== 'paused') return;
        await store.updateJob(job.id, {
          status: transition('paused', 'resume'),
          error: '',
          retryAt: null,
          heartbeat: now(),
        });
        continue;
      }
      failures = 0;

      // Source order: each accepted track lands at its own position.
      for (const r of results) {
        if (r.status === 'accepted' && r.candidates[0]) {
          await store.addTrack(job.playlistId, playlistPosition(r.position), r.candidates[0].track);
        }
      }
      await store.saveResults(results);
      const counts = await store.counts(job.id);
      await store.updateJob(job.id, {
        ...counts,
        cursor: items[items.length - 1].position + 1,
        heartbeat: now(),
      });

      if (searched) await sleep(this.deps.paceMs ?? PACE_MS);
    }
  }

  /** Items with ready candidates are accepted as they are; the rest go
   *  through the matcher in one call. */
  private async matchBatch(items: PendingItem[]): Promise<ItemResult[]> {
    const toSearch = items.filter((i) => !i.candidates.length);
    const matched = toSearch.length ? await this.deps.match(toSearch.map((i) => i.source)) : [];
    if (matched.length !== toSearch.length) throw new Error('the matcher returned the wrong number of results');
    const byId = new Map(toSearch.map((item, k) => [item.id, matched[k]]));
    return items.map((item) => {
      const m = byId.get(item.id);
      if (!m) {
        return {
          itemId: item.id,
          position: item.position,
          status: 'accepted',
          videoId: item.candidates[0].track.sourceId,
          confidence: item.candidates[0].score,
          candidates: item.candidates,
        };
      }
      return {
        itemId: item.id,
        position: item.position,
        status: m.status,
        videoId: m.status === 'accepted' ? (m.candidates[0]?.track.sourceId ?? null) : null,
        confidence: m.confidence,
        candidates: m.candidates,
      };
    });
  }
}
