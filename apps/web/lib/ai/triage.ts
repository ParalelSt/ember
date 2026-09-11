import 'server-only';
import { z } from 'zod';
import type { LogEntry, ReportContext, ServerLogEntry } from '@/lib/logger/types';
import { serverLogger } from '@/lib/logger/server';

/** AI triage for bug reports.
 *
 *  A raw report is a wall of JSONL nobody reads. This condenses the logs,
 *  asks Claude what actually went wrong, and puts the answer at the top of
 *  the Discord embed so a report can be understood at a glance.
 *
 *  Strictly best-effort: no API key, a bad response, or an Anthropic outage
 *  all return null and the report still sends. Triage must never be the
 *  reason a bug report is lost. */

const BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
// Reports are rare (rate-limited, handful of users), so the better model is
// worth pennies. Override with BUG_TRIAGE_MODEL=claude-haiku-4-5-20251001 to
// go cheaper.
const MODEL = process.env.BUG_TRIAGE_MODEL || 'claude-sonnet-5';
const TIMEOUT_MS = 25_000;

/** Caps. The digest is what we pay for, so it's bounded at every level. */
const MAX_CLIENT_CURRENT = 60;
const MAX_CLIENT_PREVIOUS = 15;
const MAX_SERVER = 40;
const MAX_MESSAGE_CHARS = 300;
const MAX_DATA_CHARS = 200;
const MAX_STACK_LINES = 3;
const MAX_DIGEST_CHARS = 14_000;
// The desktop log's own file is attached in full to the report; only a tail
// goes into the prompt, same reasoning as the other caps here.
const MAX_DESKTOP_LOG_LINES = 60;

export const AREAS = [
  'playback',
  'streaming',
  'auth',
  'library',
  'search',
  'import',
  'sessions',
  'ui',
  'server',
  'unknown',
] as const;

// Exported for tests/ai-triage.test.mjs's unit-level checks (parsing a
// hand-built model reply without a network call).
export const TriageSchema = z.object({
  summary: z.string().min(1).max(300),
  likelyCause: z.string().min(1).max(800),
  area: z.enum(AREAS).catch('unknown'),
  severity: z.enum(['low', 'medium', 'high']).catch('medium'),
  confidence: z.enum(['low', 'medium', 'high']).catch('low'),
  nextSteps: z.array(z.string().max(300)).max(4).default([]),
  // A short hypothesis of concrete steps to reproduce, or "unknown" when the
  // logs don't support one: .catch() covers both a missing key (older/odd
  // model replies) and an out-of-range value.
  reproduction: z.string().min(1).max(500).catch('unknown'),
});

export type Triage = z.infer<typeof TriageSchema>;

export interface TriageInput {
  note: string;
  client: { current: LogEntry[]; previous: LogEntry[]; sessionId: string };
  server: ServerLogEntry[];
  userAgent: string;
  // Optional: the route drops a malformed (non-object) context before it
  // ever reaches here (see sanitizeContext in app/api/bug-report/route.ts),
  // so an absent context is a normal, expected shape, not an error.
  context: ReportContext | undefined;
  /** Tail of the desktop shell's own log, when the report came from Tauri.
   *  Only the last MAX_DESKTOP_LOG_LINES lines go into the prompt; the full
   *  tail is attached to the Discord message separately (see route.ts). */
  desktopLog?: string;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** reqId travels differently on each side: a server entry carries it as its
 *  own field (withRequestLog, T2), a client "api" error carries it inside
 *  `data.reqId` (lib/api.ts echoes the response's x-request-id header back
 *  into the error it logs). Read either shape so both render the same tag. */
function reqIdOf(e: LogEntry | ServerLogEntry): string | undefined {
  if ('reqId' in e && typeof e.reqId === 'string' && e.reqId) return e.reqId;
  const data = e.data;
  if (data && typeof data === 'object' && 'reqId' in data) {
    const v = (data as Record<string, unknown>).reqId;
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** Short enough to stay readable in a line, long enough that two unrelated
 *  requests colliding in one digest (a few dozen entries) is vanishingly
 *  unlikely. */
function shortReqId(id: string): string {
  return id.slice(0, 8);
}

function stringifyData(data: unknown, reqId: string | undefined): string {
  if (data === undefined || data === null) return '';
  // reqId is already rendered in the line's head tag; drop it here so it
  // isn't printed twice.
  let toRender: unknown = data;
  if (reqId && typeof data === 'object' && data !== null && 'reqId' in data) {
    const rest: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    delete rest.reqId;
    toRender = rest;
    if (Object.keys(rest).length === 0) return '';
  }
  try {
    return ` ${clip(JSON.stringify(toRender), MAX_DATA_CHARS)}`;
  } catch {
    return '';
  }
}

/** One log entry → one line. Times are relative ("-12.4s") because absolute
 *  timestamps burn tokens and the ordering is what matters for diagnosis. */
function line(e: LogEntry | ServerLogEntry, now: number): string {
  const age = ((e.ts - now) / 1000).toFixed(1);
  const reqId = reqIdOf(e);
  const reqTag = reqId ? ` {req ${shortReqId(reqId)}}` : '';
  const levelTag = e.level === 'error' ? 'ERROR' : e.level === 'warn' ? 'WARN' : 'info';
  const head = `[${age}s]${reqTag} ${levelTag} ${e.category}: ${clip(e.message, MAX_MESSAGE_CHARS)}`;
  const stack = e.stack
    ? `\n    ${e.stack.split('\n').slice(0, MAX_STACK_LINES).map((l) => l.trim()).join('\n    ')}`
    : '';
  return head + stringifyData(e.data, reqId) + stack;
}

/** Collapse runs of the same message into "xN". A stuck retry loop can emit
 *  the same line 200 times; that's one fact, not 200. */
function dedupe(lines: string[]): string[] {
  const out: string[] = [];
  let last = '';
  let count = 0;
  const flush = () => {
    if (!last) return;
    out.push(count > 1 ? `${last}  (x${count})` : last);
  };
  for (const l of lines) {
    const key = l.replace(/^\[-?[\d.]+s\]\s*/, '');
    if (key === last.replace(/^\[-?[\d.]+s\]\s*/, '') && last) {
      count++;
      continue;
    }
    flush();
    last = l;
    count = 1;
  }
  flush();
  return out;
}

/** Errors are the signal; keep every one and fill the rest with breadcrumbs
 *  from the tail (closest in time to the report). */
function pick(entries: LogEntry[], max: number): LogEntry[] {
  if (entries.length <= max) return entries;
  const errors = entries.filter((e) => e.level === 'error');
  const kept = new Set(errors.slice(-max));
  for (let i = entries.length - 1; i >= 0 && kept.size < max; i--) kept.add(entries[i]);
  return entries.filter((e) => kept.has(e));
}

function bytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** `label: value`, or nothing when value is genuinely empty (null/undefined/
 *  ''). Booleans and 0 are real, reportable state: not "empty". */
function contextLine(label: string, value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return `${label}: ${value}`;
}

/** Renders `ReportContext` as one line per field so the model sees exactly
 *  what the app was doing when the report was filed, before it ever reads a
 *  log line. This block is never subject to the digest's char budget (see
 *  buildDigest): it's small and it's the one part of the prompt that's
 *  always trustworthy (the rest is reconstructed from possibly-incomplete
 *  logs). */
function buildContextBlock(ctx: ReportContext | undefined): string {
  // Defensive: TriageInput.context is required by the type, but this digest
  // must never be the thing that turns a malformed/old-client payload into a
  // lost bug report (see triageBugReport's doc comment).
  if (!ctx) return '## State when reported\n(no context)';
  const lines = [
    contextLine('app version', ctx.appVersion),
    contextLine('shell', ctx.shell),
    contextLine('platform', ctx.platform),
    contextLine('language', ctx.language),
    contextLine('online', ctx.online),
    contextLine('route', ctx.route),
    ctx.viewport?.w || ctx.viewport?.h ? `viewport: ${ctx.viewport.w}x${ctx.viewport.h}` : null,
    ctx.track ? `track: "${clip(ctx.track.title, 80)}" (${ctx.track.source}:${ctx.track.id})` : null,
    ctx.queue?.length ? `queue: ${ctx.queue.index + 1}/${ctx.queue.length}` : null,
    contextLine('backend', ctx.backendKind),
    contextLine('playing', ctx.isPlaying),
    contextLine('loop', ctx.loopMode),
    contextLine('shuffle', ctx.shuffle),
    ctx.offlinePins > 0 ? `offline pins: ${ctx.offlinePins}` : null,
    ctx.storageEstimate
      ? `storage: ${bytes(ctx.storageEstimate.usage)} / ${bytes(ctx.storageEstimate.quota)}`
      : null,
  ].filter((l): l is string => l !== null);
  return `## State when reported\n${lines.join('\n') || '(no context)'}`;
}

export function buildDigest(input: TriageInput): string {
  const now = Date.now();
  const contextBlock = buildContextBlock(input.context);

  const curLines = dedupe(pick(input.client.current, MAX_CLIENT_CURRENT).map((e) => line(e, now)));
  const prevLines = input.client.previous.length > 0
    ? dedupe(pick(input.client.previous, MAX_CLIENT_PREVIOUS).map((e) => line(e, now)))
    : [];
  const srvLines = dedupe(pick(input.server, MAX_SERVER).map((e) => line(e, now)));
  const desktopLines = input.desktopLog
    ? input.desktopLog.split('\n').filter((l) => l.length > 0).slice(-MAX_DESKTOP_LOG_LINES)
    : [];

  // Order here doubles as trim priority below: earlier sections survive
  // longer than later ones.
  const sections = [
    { title: `## Client log: current session (${input.client.current.length} events)`, lines: curLines, empty: '(none)' },
    ...(input.client.previous.length > 0
      ? [{ title: `## Client log: previous session (${input.client.previous.length} events)`, lines: prevLines, empty: '(none)' }]
      : []),
    { title: `## Server log: last 5 minutes (${input.server.length} events)`, lines: srvLines, empty: '(none)' },
    ...(desktopLines.length > 0
      ? [{ title: `## Desktop log tail (last ${desktopLines.length} lines)`, lines: desktopLines, empty: '' }]
      : []),
  ];

  const render = () =>
    [contextBlock, ...sections.map((s) => `${s.title}\n${s.lines.join('\n') || s.empty}`)].join('\n\n');

  // The context block is never trimmed (per the brief). If the rest is still
  // over budget: the per-section caps above make this rare: drop entries
  // oldest-first (pick() already put entries in chronological order), client
  // sections before the server section before the desktop tail: the "what
  // was happening" state and the newest events are worth more than an old
  // breadcrumb.
  let text = render();
  let si = 0;
  while (text.length > MAX_DIGEST_CHARS && si < sections.length) {
    const s = sections[si];
    if (s.lines.length === 0) {
      si++;
      continue;
    }
    s.lines.shift();
    text = render();
  }
  return text;
}

const SYSTEM = `You triage bug reports for Ember, a self-hosted music streaming app.

Stack: Next.js App Router frontend, PocketBase for auth/data (pb_auth cookie),
a Python helper (yt-dlp + ytmusicapi) for YouTube Music search and audio, and a
server-side stream proxy that caches downloaded audio to disk. Known recurring
failure modes: YouTube 403s on expired stream URLs, PocketBase connection
errors, Python helper timeouts, and playback/queue state bugs.

You get the reporter's note (may be empty or vague), a "State when reported"
block describing exactly what the app was doing (route, track, queue
position, online/offline, playback backend), and condensed logs: client
breadcrumbs and errors (including native-app events, tagged "native:<area>",
and a desktop log tail on the Tauri app), and server request logs tagged with
a request id ("{req XXXXXXXX}"): a client "api" error and the server entry
for the same failed request share that id, so use it to line up the two
sides of one request. Work out what actually went wrong.

Reply with ONLY a JSON object, no prose and no code fences:
{
  "summary": "one sentence, what broke from the user's point of view",
  "likelyCause": "the technical cause, citing specific log evidence; say plainly if the logs don't show it",
  "area": one of ${AREAS.join(' | ')},
  "severity": "low" | "medium" | "high",
  "confidence": "low" | "medium" | "high",
  "nextSteps": ["up to 3 concrete things the maintainer should check first"],
  "reproduction": "a short hypothesis of concrete steps to reproduce this from the context and logs, or \\"unknown\\" if there isn't enough to guess"
}

Be honest: if the logs contain nothing explaining the note, say so and use
confidence "low". Never invent an error that isn't in the logs.`;

/** Pull the JSON object out of a model reply, tolerating code fences or a
 *  stray sentence before it. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(body.slice(start, end + 1));
}

export function isTriageConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function triageBugReport(input: TriageInput): Promise<Triage | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    // Digest and prompt construction happen inside the try too: a malformed
    // context (an old/odd client payload) must degrade to "no triage", not
    // a 500 that loses the whole report.
    const digest = buildDigest(input);
    const prompt = [
      `Reporter's note: ${input.note || '(none given)'}`,
      `User-agent: ${input.userAgent}`,
      '',
      digest,
    ].join('\n');

    const res = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      serverLogger.error('ai', `triage HTTP ${res.status}`, { detail: clip(detail, 300) });
      return null;
    }

    const json = (await res.json()) as { content?: { type?: string; text?: string }[] };
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
      .trim();
    if (!text) {
      serverLogger.error('ai', 'triage returned no text');
      return null;
    }

    return TriageSchema.parse(extractJson(text));
  } catch (e) {
    // Timeout, network error, malformed JSON, schema mismatch — all the same
    // here: no triage, report still goes out.
    serverLogger.error('ai', 'triage failed', undefined, e);
    return null;
  }
}
