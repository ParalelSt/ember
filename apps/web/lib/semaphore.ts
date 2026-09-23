/** Thrown when a job waited too long for a slot, or the queue was already
 *  full. 503 so the route answers "busy, try again" instead of hanging. */
export class BusyError extends Error {
  status = 503;
  constructor(message = 'The server is busy right now, try again in a moment.') {
    super(message);
  }
}

export interface SemaphoreOptions {
  /** How long a job may wait for a slot before it fails with BusyError. */
  queueTimeoutMs: number;
  /** Jobs allowed to wait at once; more fail straight away. */
  maxQueue?: number;
}

export interface Semaphore {
  /** Runs `fn` once a slot is free; the slot is released however it ends. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

interface Waiter {
  grant: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/** At most `max` jobs at once, first come first served. */
export function createSemaphore(max: number, { queueTimeoutMs, maxQueue = Infinity }: SemaphoreOptions): Semaphore {
  const limit = Math.max(1, Math.floor(max) || 1);
  let active = 0;
  const queue: Waiter[] = [];

  function release() {
    active -= 1;
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      active += 1;
      next.grant();
    }
  }

  function acquire(): Promise<void> {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    if (queue.length >= maxQueue) return Promise.reject(new BusyError());
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: resolve,
        timer: setTimeout(() => {
          const i = queue.indexOf(waiter);
          if (i !== -1) queue.splice(i, 1);
          reject(new BusyError());
        }, queueTimeoutMs),
      };
      queue.push(waiter);
    });
  }

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() { return active; },
    get waiting() { return queue.length; },
  };
}
