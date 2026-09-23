/** The background import loop (docs/imports.md, section 5).
 *
 *  One job at a time: claim the oldest queued job, then walk its items from
 *  the cursor in batches of 8. Each batch is matched (one `player.py match`
 *  process), its accepted tracks are added to the playlist at their source
 *  positions (or liked, for a `kind: 'liked'` transfer), the items are saved
 *  and the cursor moves on. A crash between those steps only repeats one
 *  batch: re-adding a track and re-liking one are both no-ops.
 *
 *  A transfer can be thousands of songs, so every ten batches it checks for
 *  a job that arrived after it and, if there is one, hands itself back to
 *  the queue at its cursor.
 *
 *  YouTube Music answers rapid searches with 503, so batches are paced, and
 *  a failed batch waits 5 s, 20 s, 60 s before trying again; after that the
 *  job is paused until someone presses Retry.
 *
 *  Everything outside the loop (PocketBase, the matcher, the clock) comes in
 *  through `RunnerDeps`, so the unit tests drive it with fakes. */

import type { Track } from '@/types/track';
import type { ImportCandidate, ImportSourceKind, JobKind, MatchResult, SourceItem } from '@/lib/import/types';
import {
  BACKOFF_MS,
  BATCH_SIZE,
  MAX_PACE_MS,
  PACE_MS,
  STALE_MS,
  YIELD_AFTER_BATCHES,
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
  kind: JobKind;
  /** Null for a transfer: its songs become likes, not playlist rows. */
  playlistId: string | null;
  /** Whose likes a transfer fills. */
  userId: string;
  /** Transfers only: accepted songs already in the person's likes. */
  existing: number;
}

export interface PendingItem {
  id: string;
  position: number;
  source: SourceItem;
  /** Filled in advance for a YouTube Music playlist: its own tracks, so no
   *  search is needed. Empty for Spotify items. */
  candidates: ImportCandidate[];
  /** Transfers only: when the like this song becomes is dated. */
  likedAt: number | null;
}

export interface ItemResult {
  itemId: string;
  position: number;
  status: 'accepted' | 'review' | 'missing';
  videoId: string | null;
  confidence: number | null;
  candidates: ImportCandidate[];
  likedAt: number | null;
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
  /** Epoch ms, or null to clear (a job that let go of its runner). */
  heartbeat?: number | null;
  /** The runner holding the job; empty to let go. */
  runner?: string;
  existing?: number;
}

export interface JobStore {
  /** Put jobs whose runner stopped checking in before `staleBefore` back in
   *  the queue. Returns how many. */
  releaseStale(staleBefore: number): Promise<number>;
  /** The oldest queued job, now running and held by `runnerId`; or null.
   *  `avoid` is a transfer that just stepped aside: any other queued job
   *  goes first, and it is taken again only when none is left. */
  claimNext(runnerId: string, now: number, avoid?: string | null): Promise<RunnerJob | null>;
  getJob(id: string): Promise<RunnerJob | null>;
  updateJob(id: string, patch: JobPatch): Promise<void>;
  /** Pending items from `fromPosition` on, in source order. */
  pendingItems(jobId: string, fromPosition: number, limit: number): Promise<PendingItem[]>;
  saveResults(results: ItemResult[]): Promise<void>;
  /** Add a track at a playlist position. Already there: a no-op. */
  addTrack(playlistId: string, position: number, track: Track): Promise<void>;
  /** Like a track for a transfer. `created` is false when the person had
   *  already liked it, which the Done summary counts separately. */
  like(userId: string, track: Track, likedAt: number | null): Promise<{ created: boolean }>;
  /** Is any other job waiting? A long transfer steps aside when one is. */
  hasOtherQueued(jobId: string): Promise<boolean>;
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
        // A transfer that stepped aside is the oldest job in the queue, so
        // without this it would be claimed straight back.
        let avoid: string | null = null;
        for (;;) {
          const job = await store.claimNext(runnerId, now(), avoid);
          if (!job) break;
          avoid = null;
          this.currentJobId = job.id;
          try {
            if (await this.runJob(job)) avoid = job.id;
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

  /** Work through one job. True when a transfer stepped aside for a
   *  waiting job rather than stopping. */
  async runJob(job: RunnerJob): Promise<boolean> {
    const { store, sleep, now } = this.deps;
    const backoff = this.deps.backoffMs ?? BACKOFF_MS;
    let failures = 0;
    let batches = 0;
    // Doubled after a backoff, for the rest of this job only: a source that
    // is having a bad evening is worth going slower for, but the next job
    // starts fresh.
    let pace = this.deps.paceMs ?? PACE_MS;
    for (;;) {
      const fresh = await store.getJob(job.id);
      // Cancelled, deleted with its playlist, or handed back to the queue.
      if (!fresh || fresh.status !== 'running') return false;

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
        return false;
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
          return false;
        }
        await store.updateJob(job.id, {
          status: transition('running', 'backoff'),
          error: BUSY_MESSAGE,
          retryAt: now() + wait,
        });
        await sleep(wait);
        const after = await store.getJob(job.id);
        // Cancelled, or Retry pressed (back to queued) while waiting.
        if (!after || after.status !== 'paused') return false;
        await store.updateJob(job.id, {
          status: transition('paused', 'resume'),
          error: '',
          retryAt: null,
          heartbeat: now(),
        });
        pace = Math.min(pace * 2, MAX_PACE_MS);
        continue;
      }
      failures = 0;

      // A transfer likes what it accepted; a playlist import puts each
      // accepted track at its own source position.
      let alreadyLiked = 0;
      for (const r of results) {
        if (r.status !== 'accepted' || !r.candidates[0]) continue;
        if (job.kind === 'liked') {
          const { created } = await store.like(job.userId, r.candidates[0].track, r.likedAt);
          if (!created) alreadyLiked += 1;
        } else if (job.playlistId) {
          await store.addTrack(job.playlistId, playlistPosition(r.position), r.candidates[0].track);
        }
      }
      await store.saveResults(results);
      const counts = await store.counts(job.id);
      await store.updateJob(job.id, {
        ...counts,
        ...(job.kind === 'liked' ? { existing: fresh.existing + alreadyLiked } : {}),
        cursor: items[items.length - 1].position + 1,
        heartbeat: now(),
      });

      // A transfer can be thousands of songs, so it steps aside now and then
      // for whoever came after it. The cursor is already saved; the next
      // claim passes over it once, and it comes back when they are done.
      batches += 1;
      if (job.kind === 'liked' && batches % YIELD_AFTER_BATCHES === 0 && (await store.hasOtherQueued(job.id))) {
        this.deps.log?.('transfer yielded to a waiting import', { job: job.id, batches });
        await store.updateJob(job.id, { status: transition('running', 'yield'), heartbeat: null, runner: '' });
        return true;
      }

      if (searched) await sleep(pace);
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
          likedAt: item.likedAt,
        };
      }
      return {
        itemId: item.id,
        position: item.position,
        status: m.status,
        videoId: m.status === 'accepted' ? (m.candidates[0]?.track.sourceId ?? null) : null,
        confidence: m.confidence,
        candidates: m.candidates,
        likedAt: item.likedAt,
      };
    });
  }
}
