import 'server-only';

/** The queue of one for Ember's Python jobs: lining a tab up with the
 *  recording (lib/tabAlign.ts) costs CPU on the machine that is streaming
 *  audio to everyone, so jobs wait for each other rather than running
 *  together. */

/** One queue per server PROCESS: every route is bundled on its own in a
 *  production build, and a plain module variable gave each route its own
 *  queue, so two routes' jobs ran at once (lib/sources/failureMemo.ts). */
const KEY = Symbol.for('ember.pythonJobs');
const queue = ((globalThis as Record<symbol, unknown>)[KEY] ??= { chain: Promise.resolve() }) as { chain: Promise<void> };

/** Run `job` after every job queued before it, whatever they did. */
export function queuePythonJob<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.chain.then(job);
  // The queue must never stop because one job failed.
  queue.chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
