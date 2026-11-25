/** A small async memo: answers are kept for `ttlMs` (the oldest entry goes
 *  past `max`), and callers asking for a key that is already being loaded
 *  share that one load instead of starting their own. A load that fails is
 *  never kept (everyone waiting gets the failure, the next ask retries), and
 *  `keep` can refuse to keep an answer that is cheap to ask again, such as
 *  an empty list. */
export interface TtlMemo<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
  size(): number;
}

export function createTtlMemo<T>({
  ttlMs,
  max,
  keep = () => true,
  now = Date.now,
}: {
  ttlMs: number;
  max: number;
  keep?: (value: T) => boolean;
  now?: () => number;
}): TtlMemo<T> {
  const done = new Map<string, { value: T; expires: number }>();
  const inflight = new Map<string, Promise<T>>();
  return {
    get(key, load) {
      const hit = done.get(key);
      if (hit && hit.expires > now()) return Promise.resolve(hit.value);
      if (hit) done.delete(key);
      const running = inflight.get(key);
      if (running) return running;
      const p = load().then(
        (value) => {
          inflight.delete(key);
          if (keep(value)) {
            if (done.size >= max && !done.has(key)) {
              const oldest = done.keys().next().value;
              if (oldest !== undefined) done.delete(oldest);
            }
            done.set(key, { value, expires: now() + ttlMs });
          }
          return value;
        },
        (e: unknown) => {
          inflight.delete(key);
          throw e;
        },
      );
      inflight.set(key, p);
      return p;
    },
    clear() {
      done.clear();
      inflight.clear();
    },
    size: () => done.size,
  };
}
