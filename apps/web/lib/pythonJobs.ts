import 'server-only';

/** The queue of one for Ember's Python jobs:
 *  transcribing a recording (lib/tabGenerate.ts) and lining a tab up with
 *  it (lib/tabAlign.ts) both cost CPU on the machine that is streaming
 *  audio to everyone, so they wait for each other rather than running
 *  together. */

let chain: Promise<void> = Promise.resolve();

/** Run `job` after every job queued before it, whatever they did. */
export function queuePythonJob<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job);
  // The queue must never stop because one job failed.
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
