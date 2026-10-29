import 'server-only';
import { promises as fs, appendFileSync, createReadStream, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { LogLevel, ServerLogEntry } from './types';
import { requestContext, type ServerLogContext } from './context';
import { LOG_RETENTION_DAYS } from './retention';

export { outsideRequest, requestContext, type ServerLogContext } from './context';

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
const RETENTION_DAYS = LOG_RETENTION_DAYS;

// The UTC day key (YYYY-MM-DD) the sweep last ran for, so a long-lived
// server process re-sweeps once a new day starts instead of only ever
// sweeping the one time at boot. A process that runs for days would
// otherwise let two days' worth of files past the retention window pile up
// (RETENTION_DAYS=2 keeps today + yesterday, so day 3 onward never got
// swept away without a restart).
let lastSweptDayKey: string | null = null;

function dayKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function ensureDailySweep(): void {
  const key = dayKey();
  if (lastSweptDayKey === key) return;
  lastSweptDayKey = key;
  void runSweep();
}

async function runSweep(): Promise<void> {
  try {
    const dir = logDir();
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir);
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    await Promise.all(
      entries
        // Both the daily log files and the digest's own "already sent today"
        // and "failed today" markers (digestJob.ts) live in this directory and
        // share the same YYYY-MM-DD naming, so one sweep with the same age
        // rule retires both; without this the markers never got deleted and
        // accumulated forever, one file a day.
        .filter((name) => /^(errors|digest)-\d{4}-\d{2}-\d{2}\.(jsonl|sent|failed)$/.test(name))
        .map(async (name) => {
          const dateMs = parseFileDate(name);
          // By the day's end, not its start: the file from two days ago
          // still holds entries inside the window until that day is over.
          if (dateMs && dateMs + 24 * 60 * 60 * 1000 <= cutoffMs) {
            await fs.unlink(path.join(dir, name)).catch(() => {});
          }
        }),
    );
  } catch (e) {
    console.warn('[serverLogger] sweep failed', e);
  }
}

function parseFileDate(name: string): number | null {
  const m = name.match(/^(?:errors|digest)-(\d{4})-(\d{2})-(\d{2})\.(?:jsonl|sent|failed)$/);
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

function writeEntry(
  level: LogLevel,
  category: string,
  message: string,
  data?: unknown,
  err?: unknown,
  ctx?: ServerLogContext,
): void {
  ensureDailySweep();
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

/** Same line as info(), written before it returns: for the moment the
 *  process is being stopped and an async append might never finish. */
function infoSync(category: string, message: string, data?: unknown): void {
  const entry: ServerLogEntry = {
    ts: Date.now(),
    kind: 'error',
    level: 'info',
    category,
    message,
    sessionId: 'server',
    side: 'server',
    reqId: '',
    route: '',
  };
  if (data !== undefined) entry.data = safeJson(data);
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(path.join(logDir(), todayFile()), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.warn('[serverLogger] sync append failed', e);
  }
}

export const serverLogger = {
  infoSync,

  /** Fire-and-forget append. Failures fall back to console.warn, we never
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

  /** Same shape again, one level below warn(): routine/expected events worth
   *  keeping on disk for context (an admin audit action, a rate-limited
   *  automatic report) but not a "problem", the digest (lib/reports/digest.ts)
   *  skips 'info' entries entirely, so these never show up as noise. */
  info(category: string, message: string, data?: unknown, err?: unknown, ctx?: ServerLogContext): void {
    writeEntry('info', category, message, data, err, ctx);
  },

  /** Writes a fully built entry as it is (the phone app's own player log,
 *  lib/logger/nativeLog.ts, which carries its own ts, session and surface).
 *  The caller has scrubbed it. Fire-and-forget like the rest. */
  append(entry: ServerLogEntry): void {
    ensureDailySweep();
    void appendLine(entry).catch((e) => console.warn('[serverLogger] append failed', e));
  },

  /** Returns server entries with ts > timestampMs. Reads today's + yesterday's
   *  files (covers the report window even across UTC midnight). */
  async recentSince(timestampMs: number): Promise<ServerLogEntry[]> {
    ensureDailySweep();
    try {
      const today = todayFile();
      const yesterday = todayFile(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const files = [...new Set([yesterday, today])];
      return await readEntriesFromFiles(files, (e) => e.ts > timestampMs);
    } catch (e) {
      console.warn('[serverLogger] recentSince failed', e);
      return [];
    }
  },

  /** Generalised version of recentSince for longer windows (a digest can
   *  span days, not minutes): walks every calendar day's file from
   *  timestampMs's UTC day through today, rather than assuming "today and
   *  yesterday" cover the window. `keep` is the caller's own filter, applied
   *  while reading and BEFORE the cap: the newest ENTRIES_CAP of what the
   *  caller wants, newest first, so routine lines cannot push the wanted
   *  older ones out, and a huge window still cannot load an unbounded amount
   *  of JSONL into memory. */
  async entriesSince(timestampMs: number, keep?: (e: ServerLogEntry) => boolean): Promise<ServerLogEntry[]> {
    ensureDailySweep();
    try {
      const files = filesForWindow(timestampMs);
      const wanted = (e: ServerLogEntry) => e.ts > timestampMs && (!keep || keep(e));
      return newestFirst(await readEntriesFromFiles(files, wanted, ENTRIES_CAP), ENTRIES_CAP);
    } catch (e) {
      console.warn('[serverLogger] entriesSince failed', e);
      return [];
    }
  },
};

const ENTRIES_CAP = 20_000;

function newestFirst(entries: ServerLogEntry[], cap: number): ServerLogEntry[] {
  entries.sort((a, b) => b.ts - a.ts);
  if (entries.length > cap) entries.length = cap;
  return entries;
}

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
 *  lines the same way both recentSince and entriesSince always have. Read
 *  line by line from a stream: an error storm's day file can be larger than
 *  a string may be, and was then read as nothing. With `cap`, never more
 *  than twice that many entries are held: the newest `cap` are kept each
 *  time the pile reaches it. */
async function readEntriesFromFiles(
  files: string[],
  keep: (e: ServerLogEntry) => boolean,
  cap?: number,
): Promise<ServerLogEntry[]> {
  const dir = logDir();
  let out: ServerLogEntry[] = [];
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line) continue;
        let e: ServerLogEntry;
        try {
          e = JSON.parse(line) as ServerLogEntry;
        } catch {
          // Corrupt line: skip.
          continue;
        }
        if (!e || typeof e !== 'object' || !keep(e)) continue;
        out.push(e);
        if (cap !== undefined && out.length >= cap * 2) out = newestFirst(out, cap);
      }
    } catch {
      // Missing or unreadable file (the sweep may remove one between the
      // listing and the read): skip it, never the whole read.
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
