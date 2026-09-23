import 'server-only';
import { BusyError } from '@/lib/semaphore';

/** Caps how many yt-dlp downloads run at once on the host.
 *
 *  Without it, N listeners on N uncached songs spawn N yt-dlp processes, and
 *  the auto cache (phones and browsers prefetching the next songs) would make
 *  that worse. Two is enough for a few friends and leaves CPU for the app.
 *
 *  Listeners who are actually playing queue FIFO for a slot. A prefetch is
 *  never allowed to queue: it takes a slot only when the host is idle
 *  (`tryAcquireIdle`), so a real play always finds one free.
 *
 *  This is also the download lane of the Python helper cap (bughunt S04, see
 *  lib/sources/youtube.ts): yt-dlp downloads are counted here and only here.
 *  A listener's wait is bounded there (60 s, then a 503 and the stream route
 *  falls back to live streaming). */

/** Hands back a slot. Calling it twice is harmless. */
export type Release = () => void;

export interface AcquireOptions {
  /** Give up with a BusyError after waiting this long. Default: wait forever. */
  timeoutMs?: number;
  /** Refuse with a BusyError straight away when this many already wait. */
  maxWaiting?: number;
}

export interface DownloadGate {
  /** Waits for a slot, first come first served. */
  acquire(opts?: AcquireOptions): Promise<Release>;
  /** A slot only when nothing is running AND nobody is waiting, else null. */
  tryAcquireIdle(): Release | null;
  /** Downloads holding a slot right now. */
  inFlightCount(): number;
  /** Callers waiting for a slot. */
  waitingCount(): number;
}

interface Waiter {
  grant: (release: Release) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createDownloadGate(max: number): DownloadGate {
  const limit = Math.max(1, Math.floor(max));
  let running = 0;
  const waiting: Waiter[] = [];

  const makeRelease = (): Release => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = waiting.shift();
      // Hand the slot straight to the next waiter so a fresh acquire cannot
      // jump the queue between the release and the wake-up. A waiter that
      // timed out already left the queue, so a slot never goes to nobody.
      if (next) {
        if (next.timer) clearTimeout(next.timer);
        next.grant(makeRelease());
      } else running--;
    };
  };

  return {
    acquire({ timeoutMs, maxWaiting }: AcquireOptions = {}) {
      if (running < limit && waiting.length === 0) {
        running++;
        return Promise.resolve(makeRelease());
      }
      if (maxWaiting !== undefined && waiting.length >= maxWaiting) return Promise.reject(new BusyError());
      return new Promise<Release>((resolve, reject) => {
        const waiter: Waiter = { grant: resolve, timer: null };
        if (timeoutMs !== undefined) {
          waiter.timer = setTimeout(() => {
            const i = waiting.indexOf(waiter);
            if (i !== -1) waiting.splice(i, 1);
            reject(new BusyError());
          }, timeoutMs);
        }
        waiting.push(waiter);
      });
    },
    tryAcquireIdle() {
      if (running > 0 || waiting.length > 0) return null;
      running++;
      return makeRelease();
    },
    inFlightCount: () => running,
    waitingCount: () => waiting.length,
  };
}

/** `MAX_CONCURRENT_DOWNLOADS` (default 2); junk or values under 1 mean 2. */
export function maxConcurrentDownloads(env: string | undefined = process.env.MAX_CONCURRENT_DOWNLOADS): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

export const downloadGate: DownloadGate = createDownloadGate(maxConcurrentDownloads());

/** A prefetch that would have had to start a cold download while the host
 *  was busy, or a listener's download that waited too long for a slot, gets
 *  the shared BusyError (lib/semaphore): 503, with the Retry-After seconds a
 *  prefetch route passes on. */
export { BusyError, isBusyError } from '@/lib/semaphore';
