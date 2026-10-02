import type { ServerLogEntry } from '@/lib/logger/types';

/** The server log entries one member's bug report may carry. The log is the
 *  whole server's, so the last few minutes of it hold everyone's failures
 *  (another member's lyrics or stream errors, with their song ids and search
 *  words); a report goes to Discord and to the triage model with the
 *  reporter's name on it, so it keeps:
 *
 *    - the reporter's own entries (logged while handling their requests), whole
 *    - server-wide entries, logged outside any request (a background job, the
 *      server itself), as their bare message only: their details (`data`, the
 *      stack) can name a song, a file or a search that was someone else's
 *
 *  and never an entry from another member's request, nor one from a request
 *  nobody was signed in to (it cannot be told apart from someone else's). */
export function entriesForReporter(entries: ServerLogEntry[], userId: string): ServerLogEntry[] {
  const out: ServerLogEntry[] = [];
  for (const e of entries) {
    if (e.userId) {
      if (userId && e.userId === userId) out.push(e);
      continue;
    }
    if (e.reqId) continue;
    // Field by field, so a field added to entries later stays out until
    // someone decides it is safe here.
    out.push({
      ts: e.ts,
      kind: e.kind,
      level: e.level,
      category: e.category,
      message: e.message,
      sessionId: e.sessionId,
      side: e.side,
      reqId: '',
      route: e.route,
    });
  }
  return out;
}
