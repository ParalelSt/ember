/** The import job's life, as a table (docs/imports.md, section 5).
 *
 *    queued ──claim──▶ running ──finish──▶ done
 *      ▲                 │  ▲
 *      │              backoff│resume
 *      │                 ▼  │
 *      └──retry/boot── paused (retry_at set: waits, then resumes;
 *                            empty: waits for the Retry button)
 *
 *  running can also fail (failed, retryable) and anything unfinished can be
 *  cancelled. A server that stops mid-job leaves it `running` with a stale
 *  heartbeat; the next boot puts it back to `queued` and the cursor says
 *  where to pick up. Pure: the runner and the routes both go through it. */

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type ItemStatus = 'pending' | 'accepted' | 'review' | 'missing' | 'resolved' | 'skipped';

export type JobEvent =
  /** The runner takes the oldest queued job. */
  | 'claim'
  /** YouTube said 503 (or the helper failed): wait, then try again. */
  | 'backoff'
  /** The backoff wait is over. */
  | 'resume'
  /** Out of backoff tries: wait for the Retry button. */
  | 'give-up'
  | 'finish'
  | 'fail'
  | 'cancel'
  /** The Retry button, on a paused or failed job. */
  | 'retry'
  /** A long transfer steps aside so a job that arrived later can run. */
  | 'yield'
  /** A server restart found the job held by a runner that is gone. */
  | 'boot';

const TABLE: Record<JobStatus, Partial<Record<JobEvent, JobStatus>>> = {
  queued: { claim: 'running', cancel: 'cancelled' },
  running: {
    backoff: 'paused',
    'give-up': 'paused',
    finish: 'done',
    fail: 'failed',
    cancel: 'cancelled',
    boot: 'queued',
    yield: 'queued',
  },
  paused: { resume: 'running', cancel: 'cancelled', retry: 'queued', boot: 'queued', fail: 'failed' },
  failed: { retry: 'queued', cancel: 'cancelled' },
  done: {},
  cancelled: {},
};

export class InvalidTransition extends Error {
  readonly from: JobStatus;
  readonly event: JobEvent;

  constructor(from: JobStatus, event: JobEvent) {
    super(`an import that is ${from} cannot ${event}`);
    this.from = from;
    this.event = event;
  }
}

export function canTransition(from: JobStatus, event: JobEvent): boolean {
  return TABLE[from]?.[event] !== undefined;
}

export function transition(from: JobStatus, event: JobEvent): JobStatus {
  const to = TABLE[from]?.[event];
  if (!to) throw new InvalidTransition(from, event);
  return to;
}

/** Still going (or about to): the sidebar and the page keep polling. */
export function isActive(status: JobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}

/** Source items matched per `player.py match` process. */
export const BATCH_SIZE = 8;
/** Wait between batches, so a long playlist never hammers YouTube Music. */
export const PACE_MS = 1500;
/** Waits after a 503 or a helper failure, one per try; then paused. */
export const BACKOFF_MS = [5_000, 20_000, 60_000] as const;
/** A running job whose runner has not checked in for this long is orphaned. */
export const STALE_MS = 30_000;
/** How many batches a transfer works through before it checks whether
 *  someone else is waiting. One runner works one job to the end, so a
 *  friend's 40-track import would otherwise sit behind a 5 000-song
 *  transfer for the best part of an hour. */
export const YIELD_AFTER_BATCHES = 10;
/** Most source songs one transfer may carry. */
export const MAX_TRANSFER_ITEMS = 10_000;
/** A job that has already been told to slow down paces twice as slowly for
 *  the rest of its run, up to this. */
export const MAX_PACE_MS = 6_000;

/** The playlist_tracks position for a source item. Positions start at 1
 *  (PocketBase's required number check rejects 0), and every import row
 *  sits at its own source position, so tracks added out of order (a review
 *  pick after the rest) still sort into source order. */
export function playlistPosition(sourcePosition: number): number {
  return sourcePosition + 1;
}

/** The job's counts from its items: accepted and resolved both count as
 *  added. */
export function countItems(statuses: ItemStatus[]): { accepted: number; review: number; missing: number } {
  let accepted = 0;
  let review = 0;
  let missing = 0;
  for (const s of statuses) {
    if (s === 'accepted' || s === 'resolved') accepted++;
    else if (s === 'review') review++;
    else if (s === 'missing') missing++;
  }
  return { accepted, review, missing };
}
