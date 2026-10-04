/** Tells a brief connection blip from a real outage. A blip makes several
 *  api calls fail at the same instant with no HTTP answer at all, then the
 *  next ones succeed: as one automatic report per failed call it was pure
 *  noise (discord-2026-10-04 item 6). A run of network failures starts with
 *  the first one and ends as soon as the server answers anything (any HTTP
 *  status, see req() in api.ts) or after RUN_GAP_MS with no failure. Only a
 *  run lasting longer than PERSIST_MS counts as an outage worth reporting. */

export const PERSIST_MS = 30_000;
const RUN_GAP_MS = 30_000;

let runStart: number | null = null;
let lastFailure = 0;

/** Work waiting for the server to answer again (whenConnectionBack). */
let waiting: Array<() => void> = [];

/** The server answered: whatever run of network failures was going on is
 *  over, and whatever was waiting for it runs now. */
export function connectionOk(): void {
  runStart = null;
  if (waiting.length === 0) return;
  const run = waiting;
  waiting = [];
  for (const fn of run) {
    try {
      fn();
    } catch {
      // One waiter failing must not stop the others, nor the request that
      // just got its answer.
    }
  }
}

/** Runs `fn` once, the next time the server answers anything. For what
 *  cannot reach it during an outage, like the report about that outage. */
export function whenConnectionBack(fn: () => void): void {
  waiting.push(fn);
}

/** Records one network failure at `now`. True once the current run has been
 *  failing for longer than PERSIST_MS (a real outage, not a blip). */
export function networkFailure(now: number = Date.now()): boolean {
  if (runStart === null || now - lastFailure > RUN_GAP_MS) runStart = now;
  lastFailure = now;
  return now - runStart > PERSIST_MS;
}
