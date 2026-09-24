import type { LogLevel, ServerLogEntry } from '../logger/types';
import { fingerprint } from './fingerprint';
import { extractStatus } from './timeline';

export interface DigestGroup {
  fingerprint: string;
  route: string;
  category: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Most recent occurrence in the group: the freshest detail to show. */
  example: ServerLogEntry;
  level: LogLevel;
}

/** Groups server entries after `sinceMs` by fingerprint, for a periodic
 *  "here's what broke" digest. One group per distinct bug, not one line per
 *  occurrence. */
export function groupForDigest(entries: ServerLogEntry[], sinceMs: number): DigestGroup[] {
  const groups = new Map<string, DigestGroup>();

  for (const e of entries) {
    if (e.ts <= sinceMs) continue;
    // 'info' is for routine/expected events worth keeping on disk (an admin
    // audit action, a rate-limited automatic report) but not a "problem":
    // never counted, and never promoted to visibility by an 'error' in the
    // same fingerprint the way 'warn' can be.
    if (e.level === 'info') continue;
    const fp = fingerprint(e);
    const existing = groups.get(fp);
    if (!existing) {
      groups.set(fp, {
        fingerprint: fp,
        route: e.route,
        category: e.category,
        count: 1,
        firstSeen: e.ts,
        lastSeen: e.ts,
        example: e,
        level: e.level,
      });
      continue;
    }
    existing.count++;
    if (e.ts < existing.firstSeen) existing.firstSeen = e.ts;
    if (e.ts >= existing.lastSeen) {
      existing.lastSeen = e.ts;
      existing.example = e;
    }
    // Escalate: a group that ever included a hard error is worth flagging
    // as one even if most occurrences were warnings.
    if (e.level === 'error') existing.level = 'error';
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Plain-text digest lines, one per group, for Discord and for the model
 *  prompt alike: "12x  api  GET /api/youtube/stream -> 502  first 08:12
 *  last 19:40  e.g. yt-dlp exit 1 ...". */
export function formatDigest(groups: DigestGroup[], { since, until }: { since: number; until: number }): string {
  const header = `Digest ${fmtTime(since)}-${fmtTime(until)} UTC`;
  if (groups.length === 0) return `${header}\n(no errors)`;

  const lines = groups.map((g) => {
    const status = extractStatus(g.example.data);
    const target = status !== undefined ? `${g.route || g.category} -> ${status}` : g.route || g.category;
    return `${g.count}x  ${g.category}  ${target}  first ${fmtTime(g.firstSeen)} last ${fmtTime(g.lastSeen)}  e.g. ${clip(g.example.message, 120)}`;
  });

  return [header, ...lines].join('\n');
}
