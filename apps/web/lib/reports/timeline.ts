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
}

const DEFAULT_MAX_LINES = 25;

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
function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n').map((l) => l.trim()).filter(Boolean);
  // lines[0] is usually "Error: message", not a frame — search from 1 first
  // so it's only used as a last resort.
  const frame = lines.slice(1).find((l) => l.includes('apps/web/') || l.includes('/app/'));
  return frame ?? lines[1];
}

function clientText(e: LogEntry): string {
  const base = e.category.startsWith('native:') ? `${e.message} [${e.category}]` : e.message;
  const frame = trimStack(e.stack);
  return frame ? `${base}\n        ${frame}` : base;
}

function serverText(e: ServerLogEntry): string {
  const status = extractStatus(e.data);
  const target = e.route || e.category;
  const base = status !== undefined ? `${target} -> ${status}` : `${target}: ${e.message}`;
  const frame = trimStack(e.stack);
  return frame ? `${base}\n        ${frame}` : base;
}

/** Flattens client + server entries into a single chronological array of
 *  lines, capped to the most recent `maxLines`. Grouping into "Errors" /
 *  "Before it" blocks and reqId pairing happen at format time, not here —
 *  this is just "what happened, in order". */
export function buildTimeline({ client, server, reportedAt, maxLines = DEFAULT_MAX_LINES }: BuildTimelineOptions): TimelineLine[] {
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
  return all.length <= maxLines ? all : all.slice(all.length - maxLines);
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
