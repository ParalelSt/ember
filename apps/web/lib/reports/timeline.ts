import type { LogEntry, LogLevel, ServerLogEntry } from '../logger/types';

/** One rendered line of a report's readable timeline. `t` is relative to
 *  the report's own timestamp (reportedAt), in ms, so it's negative for
 *  everything that happened before the report was filed. */
export interface TimelineLine {
  t: number;
  text: string;
  level: LogLevel;
  side: 'client' | 'server';
  reqId?: string;
}

export interface BuildTimelineOptions {
  client: LogEntry[];
  server: ServerLogEntry[];
  reportedAt: number;
  /** Most recent lines kept when there are more than this many. */
  maxLines?: number;
  /** Minimum number of error-level lines to keep when trimming to maxLines:
   *  errors are the signal, so a burst of breadcrumbs must never push the
   *  one relevant error out of the timeline. Only breadcrumbs are dropped
   *  to make room while more than this many errors remain; the oldest
   *  errors are dropped only once the breadcrumbs are gone. */
  keepErrors?: number;
}

const DEFAULT_MAX_LINES = 25;
const DEFAULT_KEEP_ERRORS = 8;

/** reqId travels differently per side: a server entry carries it as its own
 *  field, a client "api" error carries it inside `data.reqId` (lib/api.ts
 *  echoes the response's x-request-id header back into the error it logs).
 *  Same convention as lib/ai/triage.ts's reqIdOf. */
function reqIdOf(e: LogEntry | ServerLogEntry): string | undefined {
  if ('reqId' in e && typeof e.reqId === 'string' && e.reqId) return e.reqId;
  const data = e.data;
  if (data && typeof data === 'object' && 'reqId' in data) {
    const v = (data as Record<string, unknown>).reqId;
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** Numeric HTTP-ish status buried in an entry's data blob, if any. */
export function extractStatus(data: unknown): number | undefined {
  if (data && typeof data === 'object' && 'status' in data) {
    const v = (data as Record<string, unknown>).status;
    if (typeof v === 'number') return v;
  }
  return undefined;
}

/** A stack trace is a wall of node_modules noise around the one frame that
 *  actually points at our code. Keep only that, as a single line. */
// Matches an in-repo frame: "apps/web/..." anywhere, or "app/..." starting
// right after a path separator (or at the very start of the line) so it
// doesn't also match an unrelated "app/" inside e.g. "node_modules/some-app/".
const IN_REPO_FRAME = /(^|\/)app\//;

function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n').map((l) => l.trim()).filter(Boolean);
  // lines[0] is usually "Error: message", not a frame: search from 1 first
  // so it's only used as a last resort.
  const frame = lines.slice(1).find((l) => l.includes('apps/web/') || IN_REPO_FRAME.test(l));
  return frame ?? lines[1];
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const MAX_DATA_CHARS = 150;

/** On error lines only: whatever extra structured data an entry carries
 *  beyond status and reqId (both already rendered elsewhere: status in the
 *  "-> 502" arrow, reqId as the "reqId ab12cd34" tag) is often the one clue
 *  that explains an otherwise bare error message, so it's worth reaching
 *  the Discord embed and the triage prompt too. Capped so one huge payload
 *  can't dominate the timeline; dropped entirely (not just emptied) when
 *  nothing but status/reqId was in there. */
function dataSuffix(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k !== 'status' && k !== 'reqId') rest[k] = v;
  }
  if (Object.keys(rest).length === 0) return '';
  let json: string;
  try {
    json = JSON.stringify(rest);
  } catch {
    return '';
  }
  return ` ${clip(json, MAX_DATA_CHARS)}`;
}

function clientText(e: LogEntry): string {
  // Native shell breadcrumbs are tagged "native:<area>"; everything else
  // (web, desktop webview, etc.) gets its own bracketed category so a
  // reader can tell where a line came from without guessing from the
  // message alone.
  const suffix = e.level === 'error' ? dataSuffix(e.data) : '';
  const base = `${e.message} [${e.category}]${suffix}`;
  const frame = trimStack(e.stack);
  return frame ? `${base}\n        ${frame}` : base;
}

function serverText(e: ServerLogEntry): string {
  const status = extractStatus(e.data);
  const target = e.route || e.category;
  const suffix = e.level === 'error' ? dataSuffix(e.data) : '';
  const base = (status !== undefined ? `${target} -> ${status}` : `${target}: ${e.message}`) + suffix;
  const frame = trimStack(e.stack);
  return frame ? `${base}\n        ${frame}` : base;
}

/** Trims a chronological (oldest-first) array down to `maxLines`, dropping
 *  the oldest breadcrumbs first; only once breadcrumbs are exhausted does it
 *  start dropping the oldest errors, and never below `keepErrors` of them
 *  (or however many exist, if fewer): errors are the signal a report
 *  exists to carry, breadcrumbs are just context around it. When keepErrors
 *  itself exceeds maxLines, the result stays over maxLines: the floor wins. */
function trimToMaxLines(all: TimelineLine[], maxLines: number, keepErrors: number): TimelineLine[] {
  if (all.length <= maxLines) return all;
  const lines = [...all];

  for (let i = 0; i < lines.length && lines.length > maxLines; ) {
    if (lines[i].level !== 'error') {
      lines.splice(i, 1);
    } else {
      i++;
    }
  }

  while (lines.length > maxLines) {
    const errorCount = lines.filter((l) => l.level === 'error').length;
    if (errorCount <= keepErrors) break;
    const idx = lines.findIndex((l) => l.level === 'error');
    if (idx === -1) break;
    lines.splice(idx, 1);
  }

  return lines;
}

/** Flattens client + server entries into a single chronological array of
 *  lines, capped to the most recent `maxLines` (error-preserving: see
 *  trimToMaxLines). Grouping into "Errors" / "Before it" blocks and reqId
 *  pairing happen at format time, not here, this is just "what happened,
 *  in order". */
export function buildTimeline({
  client,
  server,
  reportedAt,
  maxLines = DEFAULT_MAX_LINES,
  keepErrors = DEFAULT_KEEP_ERRORS,
}: BuildTimelineOptions): TimelineLine[] {
  const clientLines: TimelineLine[] = client.map((e) => ({
    t: e.ts - reportedAt,
    text: clientText(e),
    level: e.level,
    side: 'client',
    reqId: reqIdOf(e),
  }));
  const serverLines: TimelineLine[] = server.map((e) => ({
    t: e.ts - reportedAt,
    text: serverText(e),
    level: e.level,
    side: 'server',
    reqId: reqIdOf(e),
  }));

  const all = [...clientLines, ...serverLines].sort((a, b) => a.t - b.t);
  return trimToMaxLines(all, maxLines, keepErrors);
}

/** Errors are the signal; keep every one (up to `max`) and fill the rest
 *  with breadcrumbs from the tail (closest in time to the report).
 *  Order-preserving, so the result stays chronological for buildTimeline.
 *  Shared by the Discord "Evidence" field (route.ts) and the triage prompt
 *  (lib/ai/triage.ts) so both pick from a source array the same way before
 *  it's merged into one timeline. */
export function pickEntries<T extends { level: LogLevel }>(entries: T[], max: number): T[] {
  if (entries.length <= max) return entries;
  const errors = entries.filter((e) => e.level === 'error');
  const kept = new Set(errors.slice(-max));
  for (let i = entries.length - 1; i >= 0 && kept.size < max; i--) kept.add(entries[i]);
  return entries.filter((e) => kept.has(e));
}

/** Collapse runs of the same message into one entry tagged "(xN)". A stuck
 *  retry loop can emit the same line 200 times; that's one fact, not 200.
 *  Works on entries (not rendered text) so the merged occurrence still flows
 *  through buildTimeline/formatTimeline (reqId pairing, stack trimming,
 *  category tagging all keep working on it). Shared by route.ts and
 *  lib/ai/triage.ts, same reasoning as pickEntries above. */
export function dedupeEntries<T extends { message: string }>(entries: T[]): T[] {
  const out: T[] = [];
  let last: T | null = null;
  let count = 0;
  const flush = () => {
    if (!last) return;
    out.push(count > 1 ? { ...last, message: `${last.message}  (x${count})` } : last);
  };
  for (const e of entries) {
    if (last && e.message === last.message) {
      count++;
      continue;
    }
    flush();
    last = e;
    count = 1;
  }
  flush();
  return out;
}

const SELECT_CLIENT_CAP = 60;
const SELECT_SERVER_CAP = 40;

export interface SelectTimelineOptions {
  client: LogEntry[];
  server: ServerLogEntry[];
  reportedAt: number;
  /** Final line cap after picking + merging (the route uses 25; the triage
   *  prompt uses a larger one). */
  maxLines: number;
  keepErrors?: number;
  /** Per-source caps applied before merging (default: the same values
   *  lib/ai/triage.ts has always used for its prompt), so a huge raw array
   *  can't dominate error-priority picking before the final maxLines cut
   *  even sees the whole picture. */
  clientCap?: number;
  serverCap?: number;
}

/** The one place that decides which log lines make it into a report's
 *  timeline: error-priority pick, then dedupe, per source, then merge via
 *  buildTimeline. Both the Discord "Evidence" field (route.ts, maxLines 25)
 *  and the triage prompt (lib/ai/triage.ts, its larger cap) call this so a
 *  maintainer reading Discord and the model reading the prompt see the same
 *  events, just cut to a different length. */
export function selectTimeline({
  client,
  server,
  reportedAt,
  maxLines,
  keepErrors,
  clientCap = SELECT_CLIENT_CAP,
  serverCap = SELECT_SERVER_CAP,
}: SelectTimelineOptions): TimelineLine[] {
  const pickedClient = dedupeEntries(pickEntries(client, clientCap));
  const pickedServer = dedupeEntries(pickEntries(server, serverCap));
  return buildTimeline({ client: pickedClient, server: pickedServer, reportedAt, maxLines, keepErrors });
}

function formatT(t: number): string {
  const s = (t / 1000).toFixed(1);
  return `${s}s`;
}

/** Same convention as lib/ai/triage.ts's shortReqId: enough characters to
 *  make a collision within one report's handful of requests vanishingly
 *  unlikely, short enough to stay readable inline. */
function shortReqId(id: string): string {
  return id.slice(0, 8);
}

/** Renders a timeline for a human. Errors get their own "Errors" block up
 *  top (that's the signal); everything else follows under "Before it" in
 *  time order. A server line is paired under the client line that shares
 *  its reqId (one request, two sides) rather than listed twice. */
export function formatTimeline(lines: TimelineLine[]): string {
  if (lines.length === 0) return '(no timeline)';

  const clientReqIds = new Set(lines.filter((l) => l.side === 'client' && l.reqId).map((l) => l.reqId));

  const serverByReqId = new Map<string, TimelineLine[]>();
  for (const l of lines) {
    if (l.side === 'server' && l.reqId && clientReqIds.has(l.reqId)) {
      const arr = serverByReqId.get(l.reqId) ?? [];
      arr.push(l);
      serverByReqId.set(l.reqId, arr);
    }
  }
  const pairedServerLines = new Set<TimelineLine>();
  for (const arr of serverByReqId.values()) for (const l of arr) pairedServerLines.add(l);

  interface Renderable {
    line: TimelineLine;
    paired: TimelineLine[];
  }
  const renderables: Renderable[] = [];
  for (const l of lines) {
    if (pairedServerLines.has(l)) continue;
    const paired = l.side === 'client' && l.reqId ? (serverByReqId.get(l.reqId) ?? []) : [];
    renderables.push({ line: l, paired });
  }
  renderables.sort((a, b) => a.line.t - b.line.t);

  const renderOne = (r: Renderable): string[] => {
    const reqTag = r.line.reqId ? `  reqId ${shortReqId(r.line.reqId)}` : '';
    const out = [`${formatT(r.line.t)}  ${r.line.text}${reqTag}`];
    for (const p of r.paired) out.push(`        server: ${p.text}`);
    return out;
  };

  const errors = renderables.filter((r) => r.line.level === 'error');
  const rest = renderables.filter((r) => r.line.level !== 'error');

  const parts: string[] = [];
  if (errors.length > 0) {
    parts.push('Errors');
    for (const r of errors) parts.push(...renderOne(r));
  }
  if (rest.length > 0) {
    parts.push('Before it');
    for (const r of rest) parts.push(...renderOne(r));
  }
  return parts.join('\n');
}
