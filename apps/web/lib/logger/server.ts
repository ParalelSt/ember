import { AsyncLocalStorage } from 'node:async_hooks';
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ServerLogEntry } from './types';

// Logs live at <repo-root>/logs/errors-YYYY-MM-DD.jsonl.
// apps/web is two directories deep in the workspace; resolve via cwd then up.
// EMBER_LOG_DIR overrides this for tests (a temp dir per test), so it's read
// on every call rather than resolved once at module load.
// Exported so the digest job's marker files land in the same directory
// instead of re-deriving the path (the deleted admin logs route did that and
// drifted the moment EMBER_LOG_DIR arrived).
export function logDir(): string {
  return process.env.EMBER_LOG_DIR
    ? path.resolve(process.env.EMBER_LOG_DIR)
    : path.resolve(process.cwd(), '..', '..', 'logs');
}
const RETENTION_DAYS = 2;

let bootSweepStarted = false;

function ensureBootSweep(): void {
  if (bootSweepStarted) return;
  bootSweepStarted = true;
  void runBootSweep();
}

async function runBootSweep(): Promise<void> {
  try {
    const dir = logDir();
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir);
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    await Promise.all(
      entries
        // Both the daily log files and the digest's own "already sent today"
        // markers (digestJob.ts's markerPath) live in this directory and
        // share the same YYYY-MM-DD naming, so one sweep with the same age
        // rule retires both; without this the markers never got deleted and
        // accumulated forever, one file a day.
        .filter((name) => /^(errors|digest)-\d{4}-\d{2}-\d{2}\.(jsonl|sent)$/.test(name))
        .map(async (name) => {
          const dateMs = parseFileDate(name);
          if (dateMs && dateMs < cutoffMs) {
            await fs.unlink(path.join(dir, name)).catch(() => {});
          }
        }),
    );
  } catch (e) {
    console.warn('[serverLogger] boot sweep failed', e);
  }
}

function parseFileDate(name: string): number | null {
  const m = name.match(/^(?:errors|digest)-(\d{4})-(\d{2})-(\d{2})\.(?:jsonl|sent)$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d));
}

function todayFile(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `errors-${y}-${mo}-${da}.jsonl`;
}

export interface ServerLogContext {
  reqId?: string;
  route?: string;
  userId?: string;
}
/** Request-scoped context set by withRequestLog, so any serverLogger call
 *  made while handling a request carries its reqId, route and userId even
 *  when the caller (fromError and friends) passes no ctx of its own. */
export const requestContext = new AsyncLocalStorage<ServerLogContext>();


function writeEntry(
  level: 'error' | 'warn',
  category: string,
  message: string,
  data?: unknown,
  err?: unknown,
  ctx?: ServerLogContext,
): void {
  ensureBootSweep();
  const scoped = ctx ?? requestContext.getStore();
  const entry: ServerLogEntry = {
    ts: Date.now(),
    kind: 'error',
    level,
    category,
    message,
    sessionId: 'server',
    side: 'server',
    reqId: scoped?.reqId ?? '',
    route: scoped?.route ?? '',
    userId: scoped?.userId,
  };
  if (data !== undefined) entry.data = safeJson(data);
  if (err instanceof Error && err.stack) entry.stack = err.stack;
  else if (err) entry.data = { ...(entry.data as object | undefined), err: safeJson(err) };

  void appendLine(entry).catch((e) => console.warn('[serverLogger] append failed', e));
}

export const serverLogger = {
  /** Fire-and-forget append. Failures fall back to console.warn — we never
   *  let logging break a request. */
  error(category: string, message: string, data?: unknown, err?: unknown, ctx?: ServerLogContext): void {
    writeEntry('error', category, message, data, err, ctx);
  },

  /** Same shape as error(), one level down: expected/routine failures worth
   *  seeing in triage (429s, 502/504 from yt-dlp/python) but not noise on the
   *  same footing as an actual server bug. */
  warn(category: string, message: string, data?: unknown, err?: unknown, ctx?: ServerLogContext): void {
    writeEntry('warn', category, message, data, err, ctx);
  },

  /** Returns server entries with ts > timestampMs. Reads today's + yesterday's
   *  files (covers the report window even across UTC midnight). */
  async recentSince(timestampMs: number): Promise<ServerLogEntry[]> {
    ensureBootSweep();
    try {
      const today = todayFile();
      const yesterday = todayFile(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const files = [...new Set([yesterday, today])];
      const entries = await readEntriesFromFiles(files);
      return entries.filter((e) => e.ts > timestampMs);
    } catch (e) {
      console.warn('[serverLogger] recentSince failed', e);
      return [];
    }
  },

  /** Generalised version of recentSince for longer windows (a digest can
   *  span days, not minutes): walks every calendar day's file from
   *  timestampMs's UTC day through today, rather than assuming "today and
   *  yesterday" cover the window. Capped at 20000 entries, newest first, so
   *  a huge window can't load an unbounded amount of JSONL into memory. */
  async entriesSince(timestampMs: number): Promise<ServerLogEntry[]> {
    ensureBootSweep();
    try {
      const files = filesForWindow(timestampMs);
      const entries = await readEntriesFromFiles(files);
      const filtered = entries.filter((e) => e.ts > timestampMs);
      filtered.sort((a, b) => b.ts - a.ts);
      return filtered.slice(0, 20_000);
    } catch (e) {
      console.warn('[serverLogger] entriesSince failed', e);
      return [];
    }
  },
};

/** Every errors-YYYY-MM-DD.jsonl file name that could contain an entry
 *  timestamped after `sinceMs`, from that day (UTC) through today inclusive. */
function filesForWindow(sinceMs: number): string[] {
  const files = new Set<string>();
  const start = new Date(sinceMs);
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  while (cursor <= endDay) {
    files.add(todayFile(new Date(cursor)));
    cursor += dayMs;
  }
  return [...files];
}

/** Reads and parses a set of log files, skipping missing files and corrupt
 *  lines the same way both recentSince and entriesSince always have. */
async function readEntriesFromFiles(files: string[]): Promise<ServerLogEntry[]> {
  const dir = logDir();
  const lines: string[] = [];
  for (const f of files) {
    try {
      const text = await fs.readFile(path.join(dir, f), 'utf8');
      lines.push(...text.split('\n').filter(Boolean));
    } catch {
      // Missing file: fine, skip.
    }
  }
  const out: ServerLogEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as ServerLogEntry);
    } catch {
      // Corrupt line: skip.
    }
  }
  return out;
}

async function appendLine(entry: ServerLogEntry): Promise<void> {
  const dir = logDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, todayFile());
  await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
