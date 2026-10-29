/** One change at a time per key in this process: each call waits for the
 *  calls before it with the same key, and the entry is dropped once the last
 *  one finishes. The map is the process's, not this module copy's: every
 *  route bundles its own copy (lib/sources/failureMemo), so the QR approve,
 *  deny and status routes each had a lock that never saw the others. */
const LOCKS_KEY = Symbol.for('ember.keyedLocks');
const locks = ((globalThis as Record<symbol, unknown>)[LOCKS_KEY] ??= new Map()) as Map<string, Promise<void>>;
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => mine);
  locks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}
