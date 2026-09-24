import 'server-only';

/** Caps how many yt-dlp downloads run at once on the host.
 *
 *  Without it, N listeners on N uncached songs spawn N yt-dlp processes, and
 *  the auto cache (phones and browsers prefetching the next songs) would make
 *  that worse. Two is enough for a few friends and leaves CPU for the app.
 *
 *  Listeners who are actually playing queue FIFO for a slot. A prefetch is
 *  never allowed to queue: it takes a slot only when the host is idle
 *  (`tryAcquireIdle`), so a real play always finds one free. */

/** Hands back a slot. Calling it twice is harmless. */
export type Release = () => void;

export interface DownloadGate {
  /** Waits for a slot, first come first served. */
  acquire(): Promise<Release>;
  /** A slot only when nothing is running AND nobody is waiting, else null. */
  tryAcquireIdle(): Release | null;
  /** Downloads holding a slot right now. */
  inFlightCount(): number;
  /** Callers waiting for a slot. */
  waitingCount(): number;
}

export function createDownloadGate(max: number): DownloadGate {
  const limit = Math.max(1, Math.floor(max));
  let running = 0;
  const waiting: Array<(release: Release) => void> = [];

  const makeRelease = (): Release => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = waiting.shift();
      // Hand the slot straight to the next waiter so a fresh acquire cannot
      // jump the queue between the release and the wake-up.
      if (next) next(makeRelease());
      else running--;
    };
  };

  return {
    acquire() {
      if (running < limit && waiting.length === 0) {
        running++;
        return Promise.resolve(makeRelease());
      }
      return new Promise<Release>((resolve) => waiting.push(resolve));
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

/** Thrown by a prefetch that would have had to start a cold download while
 *  the host was busy. The route turns it into 503 + Retry-After. */
export class BusyError extends Error {
  readonly status = 503;
  readonly retryAfter: number;
  constructor(retryAfter = 30) {
    super('Host is busy, try again shortly.');
    this.name = 'BusyError';
    this.retryAfter = retryAfter;
  }
}

export function isBusyError(e: unknown): e is BusyError {
  return e instanceof BusyError;
}
