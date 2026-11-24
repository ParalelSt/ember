import type { ServerLogEntry } from '@/lib/logger/types';
import { OUTAGE_NOTE_PREFIX } from '@/lib/connectionBlip';
import { SERVER_STARTED } from '@/lib/serverLife';

/** True when an automatic report is the "network errors for over 30s" one
 *  (lib/autoReport.ts) and the server's own log shows Ember starting in the
 *  last `windowMs`. That outage was Ember itself being down: update.sh stops
 *  it for the whole build (about two minutes), during which the Funnel
 *  answers 502, and every signed-in device filed this report the moment
 *  Ember was back (2026-11-03, 2026-11-13, three members on 2026-11-21).
 *  The host already knows about a restart (it ran the update, the watchdog
 *  posts a crash, the digest shows the gap), so the report says nothing new.
 *  A report a person wrote is never matched: `automatic` must be set. */
export function outageExplainedByRestart(opts: {
  automatic: boolean;
  note: string;
  serverEntries: readonly ServerLogEntry[];
  now: number;
  windowMs: number;
}): boolean {
  if (!opts.automatic || !opts.note.startsWith(OUTAGE_NOTE_PREFIX)) return false;
  return opts.serverEntries.some(
    (e) => e.category === 'server' && e.message === SERVER_STARTED && opts.now - e.ts <= opts.windowMs,
  );
}
