import { promises as fs, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Records when the server starts and stops, so an outage shows up in the
 *  daily digest with its length. A tiny heartbeat file is rewritten every
 *  minute; a clean stop (SIGTERM/SIGINT) marks it stopped. At the next start,
 *  a heartbeat that is neither marked stopped nor recent means the last run
 *  died without saying so (killed, crashed, power loss). */

export const HEARTBEAT_MS = 60 * 1000;
/** Older than this with no clean stop = the process was down for a while. */
export const UNCLEAN_GAP_MS = 2 * 60 * 1000;

export interface Heartbeat {
  ts: number;
  startedAt: number;
  pid: number;
  stopped?: boolean;
  signal?: string;
}

export type PreviousRun =
  | { kind: 'first' }
  | { kind: 'clean'; uptimeMs: number; downMs: number }
  | { kind: 'unclean'; uptimeMs: number; gapMs: number; lastSeen: number }
  /** Not stopped cleanly, but restarted so fast the gap is under the
   *  threshold: still worth a line, not a warning. */
  | { kind: 'quick-restart'; uptimeMs: number; gapMs: number };

export function judgePreviousRun(prev: Heartbeat | null, now: number): PreviousRun {
  if (!prev || typeof prev.ts !== 'number') return { kind: 'first' };
  const uptimeMs = Math.max(0, prev.ts - prev.startedAt);
  const gapMs = Math.max(0, now - prev.ts);
  if (prev.stopped) return { kind: 'clean', uptimeMs, downMs: gapMs };
  if (gapMs > UNCLEAN_GAP_MS) return { kind: 'unclean', uptimeMs, gapMs, lastSeen: prev.ts };
  return { kind: 'quick-restart', uptimeMs, gapMs };
}

export function parseHeartbeat(text: string): Heartbeat | null {
  try {
    const v = JSON.parse(text) as Partial<Heartbeat>;
    if (typeof v.ts !== 'number' || typeof v.startedAt !== 'number') return null;
    return { ts: v.ts, startedAt: v.startedAt, pid: Number(v.pid) || 0, stopped: v.stopped === true, signal: v.signal };
  } catch {
    return null;
  }
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

export function heartbeatPath(dir: string): string {
  return path.join(dir, 'server-heartbeat.json');
}

export async function readHeartbeat(dir: string): Promise<Heartbeat | null> {
  try {
    return parseHeartbeat(await fs.readFile(heartbeatPath(dir), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeHeartbeat(dir: string, hb: Heartbeat): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${heartbeatPath(dir)}.${hb.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(hb));
  await fs.rename(tmp, heartbeatPath(dir));
}

/** Synchronous: used inside a signal handler where the process may end next. */
export function writeHeartbeatSync(dir: string, hb: Heartbeat): void {
  writeFileSync(heartbeatPath(dir), JSON.stringify(hb));
}

export interface LifeLogger {
  info: (category: string, message: string, data?: unknown) => void;
  warn: (category: string, message: string, data?: unknown) => void;
  /** Written before returning, for use while the process is stopping. */
  infoSync: (category: string, message: string, data?: unknown) => void;
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;
let installed = false;

/** Logs the start (and what happened to the previous run), starts the
 *  heartbeat, and installs the stop handlers. Once per process. */
export async function startServerLife(opts: {
  dir: string;
  version: string;
  log: LifeLogger;
  now?: () => number;
}): Promise<void> {
  if (installed) return;
  installed = true;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const prev = judgePreviousRun(await readHeartbeat(opts.dir), startedAt);

  if (prev.kind === 'unclean') {
    // A warning on purpose: the digest skips info, and this is the line that
    // shows an outage and how long it lasted.
    opts.log.warn('server', 'previous run ended without a clean stop', {
      gap: fmtDuration(prev.gapMs),
      gapMs: prev.gapMs,
      lastHeartbeat: new Date(prev.lastSeen).toISOString(),
      previousUptime: fmtDuration(prev.uptimeMs),
    });
  } else if (prev.kind === 'quick-restart') {
    opts.log.info('server', 'previous run ended without a clean stop (quick restart)', { gapMs: prev.gapMs });
  }
  opts.log.info('server', 'server started', {
    version: opts.version,
    pid: process.pid,
    previous: prev.kind,
    previousUptimeMs: 'uptimeMs' in prev ? prev.uptimeMs : undefined,
  });

  const beat = (extra: Partial<Heartbeat> = {}): Heartbeat => ({ ts: now(), startedAt, pid: process.pid, ...extra });
  await writeHeartbeat(opts.dir, beat()).catch(() => {});
  const timer = setInterval(() => void writeHeartbeat(opts.dir, beat()).catch(() => {}), HEARTBEAT_MS);
  timer.unref?.();

  for (const signal of SIGNALS) {
    const handler = () => {
      try {
        opts.log.infoSync('server', `server stopping (${signal})`, {
          pid: process.pid,
          uptime: fmtDuration(now() - startedAt),
        });
        writeHeartbeatSync(opts.dir, beat({ stopped: true, signal }));
      } catch {
        // Never block shutdown on bookkeeping.
      }
      // Registering a listener removes Node's default "exit on signal". If
      // nobody else (Next's own shutdown handler) is listening, put the
      // default back by re-sending the signal.
      process.removeListener(signal, handler);
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.on(signal, handler);
  }
}
