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

/** The server answered: whatever run of network failures was going on is over. */
export function connectionOk(): void {
  runStart = null;
}

/** Records one network failure at `now`. True once the current run has been
 *  failing for longer than PERSIST_MS (a real outage, not a blip). */
export function networkFailure(now: number = Date.now()): boolean {
  if (runStart === null || now - lastFailure > RUN_GAP_MS) runStart = now;
  lastFailure = now;
  return now - runStart > PERSIST_MS;
}
