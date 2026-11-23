import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logDir, serverLogger } from '@/lib/logger/server';
import { perfLogEnabled } from '@/lib/perf/hostSwitch';
import { anonSessions, buildPlatformRollup, type AnonSession, type PlatformRollup } from '@/lib/perf/platformRollup';
import { readPerf } from '@/lib/perf/store';
import { perfWebhook, type PerfWebhook } from '@/lib/reports/discord';
import { rollupMessage } from '@/lib/reports/perfRollupEmbeds';

/** The perf channel (docs/android-performance.md 5.5): every 6 hours, one
 *  Discord message with every device's performance summed up per platform
 *  (Android, iOS, Windows, macOS, Linux, always all five) and a JSON file
 *  with the numbers and one anonymous row per session. Scheduled from
 *  instrumentation-node.ts next to the daily digest; an admin can post one
 *  now or see it without posting (app/api/admin/perf-rollup).
 *
 *  Windows are fixed 6 hour slots in UTC (00, 06, 12, 18): the tick posts
 *  the slot that just ended, once, recorded in logs/perf-rollup-state.json
 *  so a restart does not post it twice. Best effort throughout: it never
 *  throws, retries a refused post a few times, and does nothing while
 *  EMBER_PERF_LOG=off. */

export const ROLLUP_PERIOD_MS = 6 * 60 * 60 * 1000;
/** The attached file is kept around this size (Discord takes 8 MB). */
export const ROLLUP_FILE_MAX_BYTES = 1024 * 1024;
const MAX_POST_ATTEMPTS = 3;
const RETRY_GAP_MS = 30 * 60 * 1000;
const STATE_FILE = 'perf-rollup-state.json';
const SALT_FILE = 'perf-rollup-salt';

export interface RollupState {
  /** Start of the newest window posted (or given up on), ms. */
  lastWindow: number;
  /** Failed posts of the window `failWindow`, and when the last one was. */
  failWindow?: number;
  failCount?: number;
  failLast?: number;
}

/** The slot `now` is in starts here; the window to post ends here. */
export function windowEnd(now: number): number {
  return Math.floor(now / ROLLUP_PERIOD_MS) * ROLLUP_PERIOD_MS;
}

/** Pure schedule: post the window that just ended unless it is done, or
 *  a failed post of it was too recent or tried too often. */
export function shouldPostNow(now: number, state: RollupState): boolean {
  const start = windowEnd(now) - ROLLUP_PERIOD_MS;
  if (state.lastWindow >= start) return false;
  if (state.failWindow === start) {
    if ((state.failCount ?? 0) >= MAX_POST_ATTEMPTS) return false;
    if (now - (state.failLast ?? 0) < RETRY_GAP_MS) return false;
  }
  return true;
}

function statePath(): string {
  return path.join(logDir(), STATE_FILE);
}

export async function readRollupState(): Promise<RollupState> {
  try {
    const raw = JSON.parse(await fs.readFile(statePath(), 'utf8')) as Partial<RollupState>;
    return {
      lastWindow: Number(raw.lastWindow) || 0,
      ...(raw.failWindow !== undefined ? { failWindow: Number(raw.failWindow), failCount: Number(raw.failCount) || 0, failLast: Number(raw.failLast) || 0 } : {}),
    };
  } catch {
    return { lastWindow: 0 };
  }
}

async function writeRollupState(state: RollupState): Promise<void> {
  try {
    await fs.mkdir(logDir(), { recursive: true });
    await fs.writeFile(statePath(), JSON.stringify(state), 'utf8');
  } catch (e) {
    // Unrecorded: at worst the window is posted again after a restart.
    console.warn('[perf-rollup] could not record the state', e);
  }
}

/** The salt that keeps the file's member and session hashes from being
 *  reversed: PERF_ROLLUP_SALT, else a random one made once per host and
 *  kept in logs/. */
export async function rollupSalt(): Promise<string> {
  const fromEnv = (process.env.PERF_ROLLUP_SALT ?? '').trim();
  if (fromEnv) return fromEnv;
  const file = path.join(logDir(), SALT_FILE);
  try {
    const kept = (await fs.readFile(file, 'utf8')).trim();
    if (kept.length >= 16) return kept;
  } catch {
    // Not made yet.
  }
  const salt = randomBytes(32).toString('hex');
  try {
    await fs.mkdir(logDir(), { recursive: true });
    await fs.writeFile(file, `${salt}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    // Unsaved, the hashes change with every run: still anonymous.
    console.warn('[perf-rollup] could not save the salt', e);
  }
  return salt;
}

export function anonHash(salt: string, kind: string, id: string): string {
  return createHash('sha256').update(`${salt}|${kind}|${id}`).digest('hex').slice(0, 10);
}

export interface RollupFile {
  since: string;
  until: string;
  serverVersion: string | null;
  totals: PlatformRollup['totals'];
  platforms: PlatformRollup['platforms'];
  sessions: AnonSession[];
  /** Sessions left out to keep the file near ROLLUP_FILE_MAX_BYTES (the oldest). */
  sessionsOmitted: number;
}

/** The attached file: the per-platform numbers and the anonymous sessions,
 *  the oldest dropped until it fits. */
export function rollupFile(rollup: PlatformRollup, sessions: AnonSession[], maxBytes = ROLLUP_FILE_MAX_BYTES): RollupFile {
  const file: RollupFile = {
    since: new Date(rollup.since).toISOString(),
    until: new Date(rollup.until).toISOString(),
    serverVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    totals: rollup.totals,
    platforms: rollup.platforms,
    sessions,
    sessionsOmitted: 0,
  };
  const size = () => Buffer.byteLength(JSON.stringify(file), 'utf8');
  let bytes = size();
  while (bytes > maxBytes && file.sessions.length) {
    const keep = Math.floor((file.sessions.length * maxBytes) / bytes * 0.95);
    const kept = Math.min(file.sessions.length - 1, Math.max(0, keep));
    file.sessionsOmitted += file.sessions.length - kept;
    file.sessions = file.sessions.slice(0, kept);
    bytes = size();
  }
  return file;
}

export interface RunRollupOptions {
  now?: number;
  /** The window; by default the 6 hours before `now` (the scheduler passes
   *  the slot that just ended). */
  since?: number;
  until?: number;
  /** Build everything, post nothing (the admin's dry run). */
  dryRun?: boolean;
}

export interface RollupResult {
  posted: boolean;
  reason?: 'off' | 'quiet' | 'no-webhook' | 'post-failed' | 'dry-run';
  /** Where it would go, never the URL. */
  webhook: PerfWebhook['via'];
  rollup: PlatformRollup;
  file: RollupFile;
  message: ReturnType<typeof rollupMessage>;
}

/** Reads the window, builds the message and the file, and posts them
 *  (unless off, quiet, a dry run or nowhere to post). Records nothing: the
 *  admin's post can be run again without taking the scheduled one. */
export async function runPerfRollup(options: RunRollupOptions = {}): Promise<RollupResult> {
  const now = options.now ?? Date.now();
  const until = options.until ?? now;
  const since = options.since ?? until - ROLLUP_PERIOD_MS;
  const target = perfWebhook();

  const entries = await readPerf(since, (e) => e.ts <= until, until).catch(() => []);
  const rollup = buildPlatformRollup(entries, since, until);
  const salt = await rollupSalt();
  const file = rollupFile(rollup, anonSessions(entries, since, until, (kind, id) => anonHash(salt, kind, id)));
  const message = rollupMessage(rollup);
  const result = (posted: boolean, reason?: RollupResult['reason']): RollupResult => ({
    posted,
    ...(reason ? { reason } : {}),
    webhook: target.via,
    rollup,
    file,
    message,
  });

  if (options.dryRun) return result(false, 'dry-run');
  if (!perfLogEnabled()) return result(false, 'off');
  if (rollup.totals.sessions === 0) return result(false, 'quiet');
  if (!target.url) return result(false, 'no-webhook');
  const ok = await post(target.url, message, file);
  return result(ok, ok ? undefined : 'post-failed');
}

async function post(url: string, message: ReturnType<typeof rollupMessage>, file: RollupFile): Promise<boolean> {
  try {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: message.content, embeds: message.embeds, allowed_mentions: { parse: [] } }));
    form.append('files[0]', new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), 'perf-rollup.json');
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      serverLogger.error('perf', `Discord rejected the perf rollup (${res.status})`, { detail: detail.slice(0, 300) });
      return false;
    }
    return true;
  } catch (e) {
    serverLogger.error('perf', 'posting the perf rollup failed', undefined, e);
    return false;
  }
}

/** One scheduled run: the window that just ended, recorded as done unless
 *  the post failed (then retried later, up to MAX_POST_ATTEMPTS). */
export async function runScheduledRollup(now: number): Promise<RollupResult | null> {
  if (!perfLogEnabled()) return null;
  const state = await readRollupState();
  if (!shouldPostNow(now, state)) return null;
  const until = windowEnd(now);
  const since = until - ROLLUP_PERIOD_MS;
  const res = await runPerfRollup({ now, since, until });
  if (res.reason === 'post-failed') {
    const count = (state.failWindow === since ? state.failCount ?? 0 : 0) + 1;
    // Given up after the last attempt: the window is marked done.
    await writeRollupState(
      count >= MAX_POST_ATTEMPTS ? { lastWindow: since } : { lastWindow: state.lastWindow, failWindow: since, failCount: count, failLast: now },
    );
  } else {
    await writeRollupState({ lastWindow: since });
  }
  return res;
}

/** The minute tick (instrumentation-node.ts): never two runs at once, never
 *  throws. */
export function createPerfRollupTick({
  now = () => Date.now(),
  run = runScheduledRollup,
}: {
  now?: () => number;
  run?: (now: number) => Promise<unknown>;
} = {}) {
  let busy = false;
  return async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await run(now());
    } catch (e) {
      console.warn('[perf-rollup] scheduled run failed', e);
    } finally {
      busy = false;
    }
  };
}
