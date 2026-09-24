import 'server-only';
import { ensureDownloaded, findCachedFile, isUnavailableError } from '@/lib/sources/youtube';
import { markTrackUnavailable } from '@/lib/trackAvailability';
import { serverLogger } from '@/lib/logger/server';

/** Background caching of played tracks, deliberately SLOW.
 *
 *  Downloads run one at a time with a gap between them. Firing a download per
 *  played track in parallel is what triggers YouTube's rate limiting — the very
 *  403s this cache exists to avoid (observed: a burst of downloads made one
 *  fail, then the same track downloaded fine moments later). Failures back off
 *  and retry instead of being dropped. */

const MAX_QUEUE = 50;
const MAX_ATTEMPTS = 3;
/** Delay before retry 1 and retry 2. */
const BACKOFF_MS = [30_000, 120_000];
/** Quiet gap between consecutive downloads. */
const GAP_MS = 3_000;
/** How long to leave a freshly-played track alone before caching it.
 *
 *  YouTube throttles a sequential stream to roughly playback speed. If we start
 *  yt-dlp on the SAME track while the user is still streaming it, the two
 *  compete for that throttled budget and the listener's audio — the thing they
 *  are actually waiting on — gets slower. Caching is never urgent; the point is
 *  to be fast NEXT time. So hang back and let the live stream have the pipe. */
const WARM_DELAY_MS = 90_000;

interface Job {
  videoId: string;
  attempt: number;
  readyAt: number;
}

const queue: Job[] = [];
const queued = new Set<string>();
let running = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wakes the drain loop out of a backoff wait, so a job queued (or pulled
 *  forward) with a short delay does not sit behind a 90 s sleep. */
let wake: (() => void) | null = null;
function sleepUntilWoken(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (wake === done) wake = null;
      resolve();
    }
    wake = done;
  });
}

/** Ask for a track to be cached. Cheap, idempotent, never throws.
 *
 *  `delayMs` defaults to WARM_DELAY_MS (hang back while someone streams it).
 *  A refused prefetch passes 0: nobody is streaming that track, and the
 *  client comes back after its Retry-After hoping to find it on disk. A
 *  shorter delay also pulls an already-queued job forward. */
export function queueCacheWarm(videoId: string, opts: { delayMs?: number } = {}): void {
  if (process.env.STREAM_CACHE_WARM === '0') return;
  if (findCachedFile(videoId)) return;
  const readyAt = Date.now() + Math.max(0, opts.delayMs ?? WARM_DELAY_MS);
  if (queued.has(videoId)) {
    const job = queue.find((j) => j.videoId === videoId && j.attempt === 0);
    if (job && readyAt < job.readyAt) {
      job.readyAt = readyAt;
      wake?.();
    }
    return;
  }
  if (queue.length >= MAX_QUEUE) return;
  queued.add(videoId);
  queue.push({ videoId, attempt: 0, readyAt });
  wake?.();
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const now = Date.now();
      const idx = queue.findIndex((j) => j.readyAt <= now);
      if (idx === -1) {
        // Everything is still backing off — wait for the soonest.
        const soonest = Math.min(...queue.map((j) => j.readyAt));
        await sleepUntilWoken(Math.max(1_000, soonest - now));
        continue;
      }

      const job = queue.splice(idx, 1)[0];
      // Someone may have played (and cached) it while we waited.
      if (findCachedFile(job.videoId)) {
        queued.delete(job.videoId);
        continue;
      }

      try {
        await ensureDownloaded(job.videoId);
        queued.delete(job.videoId);
      } catch (e) {
        if (isUnavailableError(e)) {
          // No point backing off and retrying a removed video.
          queued.delete(job.videoId);
          void markTrackUnavailable(`youtube:${job.videoId}`, e.unavailableReason);
        } else {
          const attempt = job.attempt + 1;
          if (attempt >= MAX_ATTEMPTS) {
            queued.delete(job.videoId);
            serverLogger.error('stream', 'cache warm gave up', { videoId: job.videoId, attempts: attempt }, e);
          } else {
            queue.push({ ...job, attempt, readyAt: Date.now() + BACKOFF_MS[attempt - 1] });
          }
        }
      }
      await sleep(GAP_MS);
    }
  } finally {
    running = false;
  }
}
