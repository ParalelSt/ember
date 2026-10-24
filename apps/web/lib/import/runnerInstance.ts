import 'server-only';
import os from 'node:os';
import type PocketBase from 'pocketbase';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { outsideRequest } from '@/lib/logger/context';
import { matchItems } from '@/lib/import/match';
import { createJobStore } from '@/lib/import/store';
import { ImportRunner } from '@/lib/import/runner';

// The one import runner of this server process. Kept on globalThis because
// Next bundles instrumentation.ts and the route handlers separately: a plain
// module variable would give each bundle its own runner.

const KEY = Symbol.for('ember.importRunner');
const POLL_MS = 5_000;
const HEARTBEAT_MS = 5_000;

interface Slot {
  runner: ImportRunner;
  started: boolean;
}

const envMs = (name: string): number | undefined => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== '' ? n : undefined;
};

/** The shared admin client (one sign-in, reused). Not a client of its own
 *  kept for 20 minutes: after a restore that gives the superuser a new token
 *  key, PocketBase reads the old token as a guest's, so the runner found no
 *  queued jobs and imports stalled silently. The shared one checks such
 *  answers and signs in again (lib/pocketbase/server.ts guardCatalog). */
async function adminClient(): Promise<PocketBase> {
  const pb = await createCatalogClient();
  // The heartbeat and the runner write the same job record concurrently.
  pb.autoCancellation(false);
  return pb;
}

function slot(): Slot {
  const g = globalThis as unknown as Record<symbol, Slot | undefined>;
  let s = g[KEY];
  if (!s) {
    const store = createJobStore(adminClient);
    const runner = new ImportRunner({
      store,
      match: matchItems,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      runnerId: `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`.slice(0, 60),
      paceMs: envMs('IMPORT_PACE_MS'),
      staleMs: envMs('IMPORT_STALE_MS'),
      log: (message, data) => {
        if (/failed/.test(message)) serverLogger.warn('import', message, data);
        else console.log(`[import] ${message}`, data ?? '');
      },
    });
    s = { runner, started: false };
    g[KEY] = s;
  }
  return s;
}

/** Start polling for queued imports (instrumentation.ts, once per boot).
 *  A second call is a no-op, so there is never a second runner. */
export function startImportRunner(): void {
  const s = slot();
  if (s.started) return;
  s.started = true;
  const tick = () =>
    void s.runner.tick().catch((e) => serverLogger.warn('import', 'runner pass failed', { error: (e as Error).message }));
  const poll = setInterval(tick, POLL_MS);
  poll.unref?.();
  // Say "still here" while a job is being worked on, so another server on
  // the same PocketBase never takes it over mid-batch.
  const beat = setInterval(() => {
    const id = s.runner.currentJobId;
    if (!id) return;
    void adminClient()
      .then((pb) => pb.collection('import_jobs').update(id, { heartbeat: new Date().toISOString().replace('T', ' ') }))
      .catch(() => {});
  }, HEARTBEAT_MS);
  beat.unref?.();
  tick();
}

/** A job was queued: run it now instead of at the next poll. */
export function kickImportRunner(): void {
  // The runner works through everyone's imports: started from a member's
  // request it would log every later job as theirs.
  outsideRequest(() => {
    startImportRunner();
    void slot()
      .runner.tick()
      .catch(() => {});
  });
}
