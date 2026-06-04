import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ServerLogEntry } from './types';

// Logs live at <repo-root>/logs/errors-YYYY-MM-DD.jsonl.
// apps/web is two directories deep in the workspace; resolve via cwd then up.
const LOG_DIR = path.resolve(process.cwd(), '..', '..', 'logs');
const RETENTION_DAYS = 2;

let bootSweepStarted = false;

function ensureBootSweep(): void {
  if (bootSweepStarted) return;
  bootSweepStarted = true;
  void runBootSweep();
}

async function runBootSweep(): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const entries = await fs.readdir(LOG_DIR);
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    await Promise.all(
      entries
        .filter((name) => /^errors-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
        .map(async (name) => {
          const dateMs = parseFileDate(name);
          if (dateMs && dateMs < cutoffMs) {
            await fs.unlink(path.join(LOG_DIR, name)).catch(() => {});
          }
        }),
    );
  } catch (e) {
    console.warn('[serverLogger] boot sweep failed', e);
  }
}

function parseFileDate(name: string): number | null {
  const m = name.match(/^errors-(\d{4})-(\d{2})-(\d{2})\.jsonl$/);
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

interface ServerLogContext {
  reqId?: string;
  route?: string;
  userId?: string;
}

export const serverLogger = {
  /** Fire-and-forget append. Failures fall back to console.warn — we never
   *  let logging break a request. */
  error(category: string, message: string, data?: unknown, err?: unknown, ctx?: ServerLogContext): void {
    ensureBootSweep();
    const entry: ServerLogEntry = {
      ts: Date.now(),
      kind: 'error',
      level: 'error',
      category,
      message,
      sessionId: 'server',
      side: 'server',
      reqId: ctx?.reqId ?? '',
      route: ctx?.route ?? '',
      userId: ctx?.userId,
    };
    if (data !== undefined) entry.data = safeJson(data);
    if (err instanceof Error && err.stack) entry.stack = err.stack;
    else if (err) entry.data = { ...(entry.data as object | undefined), err: safeJson(err) };

    void appendLine(entry).catch((e) => console.warn('[serverLogger] append failed', e));
  },

  /** Returns server entries with ts > timestampMs. Reads today's + yesterday's
   *  files (covers the report window even across UTC midnight). */
  async recentSince(timestampMs: number): Promise<ServerLogEntry[]> {
    ensureBootSweep();
    try {
      const today = todayFile();
      const yesterday = todayFile(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const files = [...new Set([yesterday, today])];
      const lines: string[] = [];
      for (const f of files) {
        try {
          const text = await fs.readFile(path.join(LOG_DIR, f), 'utf8');
          lines.push(...text.split('\n').filter(Boolean));
        } catch {
          // Missing file — fine, skip.
        }
      }
      const out: ServerLogEntry[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as ServerLogEntry;
          if (e.ts > timestampMs) out.push(e);
        } catch {
          // Corrupt line — skip.
        }
      }
      return out;
    } catch (e) {
      console.warn('[serverLogger] recentSince failed', e);
      return [];
    }
  },
};

async function appendLine(entry: ServerLogEntry): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, todayFile());
  await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
