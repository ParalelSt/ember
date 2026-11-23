import 'server-only';
import { promises as fs, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { logDir } from '@/lib/logger/server';
import type { PerfDigest } from './types';

/** Every member's perf digests (POST /api/perf-log), kept apart from the
 *  error log: `logs/perf-YYYY-MM-DD.jsonl` next to it, one JSON line per
 *  digest, kept 7 days (the error log keeps 2). Bounded per member and per
 *  day, so one busy phone or a broken client cannot fill the disk. Only an
 *  admin reads it back (app/api/admin/perf). */

export const PERF_STORE_LIMITS = {
  retentionDays: 7,
  /** Bytes one member may add per UTC day: about 14 h of foreground use. */
  perUserDayBytes: 256 * 1024,
  /** Bytes all members together may add per UTC day. */
  perDayBytes: 32 * 1024 * 1024,
  /** Most lines one read returns (the newest). */
  readCap: 20_000,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_RE = /^perf-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

export interface PerfStoreEntry {
  ts: number;
  userId: string;
  reqId?: string;
  digest: PerfDigest;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function perfFileName(ms: number): string {
  return `perf-${dayKey(ms)}.jsonl`;
}

/** Bytes written today, per member and in all. In memory: after a restart
 *  the day's budget starts again, which at worst doubles one day's cap. */
const budget = { day: '', total: 0, users: new Map<string, number>() };
let lastSweptDay = '';

function chargeBudget(userId: string, bytes: number, now: number): boolean {
  const day = dayKey(now);
  if (budget.day !== day) {
    budget.day = day;
    budget.total = 0;
    budget.users.clear();
  }
  const used = budget.users.get(userId) ?? 0;
  if (used + bytes > PERF_STORE_LIMITS.perUserDayBytes) return false;
  if (budget.total + bytes > PERF_STORE_LIMITS.perDayBytes) return false;
  budget.users.set(userId, used + bytes);
  budget.total += bytes;
  return true;
}

/** Deletes perf files past the retention window. Once a day. */
export async function sweepPerfStore(now = Date.now()): Promise<void> {
  const day = dayKey(now);
  if (lastSweptDay === day) return;
  lastSweptDay = day;
  try {
    const dir = logDir();
    const cutoff = now - PERF_STORE_LIMITS.retentionDays * DAY_MS;
    for (const name of await fs.readdir(dir)) {
      const m = FILE_RE.exec(name);
      if (!m) continue;
      const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      // By the day's end, as the error log does.
      if (start + DAY_MS <= cutoff) await fs.unlink(path.join(dir, name)).catch(() => {});
    }
  } catch {
    // No log directory yet: nothing to sweep.
  }
}

/** Stores one digest. false when the member's or the day's budget is used
 *  up (the digest is dropped, the caller still answers ok). */
export async function appendPerf(entry: PerfStoreEntry, now = Date.now()): Promise<boolean> {
  const line = JSON.stringify(entry) + '\n';
  if (!chargeBudget(entry.userId, Buffer.byteLength(line, 'utf8'), now)) return false;
  void sweepPerfStore(now);
  const dir = logDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, perfFileName(now)), line, 'utf8');
  return true;
}

/** Stored digests newer than `sinceMs` that `keep` accepts, newest first,
 *  at most PERF_STORE_LIMITS.readCap. Read line by line. */
export async function readPerf(sinceMs: number, keep?: (e: PerfStoreEntry) => boolean, now = Date.now()): Promise<PerfStoreEntry[]> {
  const out: PerfStoreEntry[] = [];
  const dir = logDir();
  const cap = PERF_STORE_LIMITS.readCap;
  const trim = () => {
    out.sort((a, b) => b.ts - a.ts);
    if (out.length > cap) out.length = cap;
  };
  for (let day = Date.UTC(new Date(sinceMs).getUTCFullYear(), new Date(sinceMs).getUTCMonth(), new Date(sinceMs).getUTCDate()); day <= now; day += DAY_MS) {
    const file = path.join(dir, perfFileName(day));
    try {
      const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line) continue;
        let e: PerfStoreEntry;
        try {
          e = JSON.parse(line) as PerfStoreEntry;
        } catch {
          continue;
        }
        if (!e || typeof e !== 'object' || typeof e.ts !== 'number' || e.ts <= sinceMs || !e.digest) continue;
        if (keep && !keep(e)) continue;
        out.push(e);
        if (out.length >= cap * 2) trim();
      }
    } catch {
      // A missing day: skip it.
    }
  }
  trim();
  return out;
}

/** Tests only. */
export function _resetPerfStore(): void {
  budget.day = '';
  budget.total = 0;
  budget.users.clear();
  lastSweptDay = '';
}
