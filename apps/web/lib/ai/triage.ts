import 'server-only';
import { z } from 'zod';
import type { LogEntry, ReportContext, ServerLogEntry } from '@/lib/logger/types';
import { serverLogger } from '@/lib/logger/server';
import { fingerprint } from '@/lib/reports/fingerprint';
import { historyFor } from '@/lib/reports/history';
import { buildTimeline, formatTimeline } from '@/lib/reports/timeline';

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
  /** Server entries from a wider window (route.ts fetches this once via
   *  serverLogger.entriesSince, typically the last 7 days) used only to
   *  count how often each error fingerprint in this report has occurred
   *  before ("seen before"). Absent/empty degrades to "first time" for
   *  everything, never to a thrown error. */
  history?: ServerLogEntry[];
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Errors are the signal; keep every one and fill the rest with breadcrumbs
 *  from the tail (closest in time to the report). Order-preserving, so the
 *  result stays chronological for buildTimeline. */
function pick<T extends { level: string }>(entries: T[], max: number): T[] {
  if (entries.length <= max) return entries;
  const errors = entries.filter((e) => e.level === 'error');
  const kept = new Set(errors.slice(-max));
  for (let i = entries.length - 1; i >= 0 && kept.size < max; i--) kept.add(entries[i]);
  return entries.filter((e) => kept.has(e));
}

/** Collapse runs of the same message into one entry tagged "(xN)". A stuck
 *  retry loop can emit the same line 200 times; that's one fact, not 200.
 *  Works on entries (not rendered text) so the merged occurrence still flows
 *  through buildTimeline/formatTimeline (T1's reqId pairing, stack trimming,
 *  native: tagging all keep working on it). */
function dedupeEntries<T extends { message: string }>(entries: T[]): T[] {
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

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** One line per distinct server-error fingerprint in `entries` (this
 *  report's own server errors), reporting how often that same bug has shown
 *  up in `history` (route.ts passes the last 7 days via
 *  serverLogger.entriesSince): turns a bare error into "this has been
 *  happening all week" or "brand new". Shared by the Discord embed's "Seen
 *  before" field (route.ts) and the triage prompt below, so the model
 *  reasons over the same signal a human reading the report sees. */
export function formatSeenBefore(entries: ServerLogEntry[], history: ServerLogEntry[]): string {
  const errors = entries.filter((e) => e.level === 'error');
  if (errors.length === 0) return '(no server errors in this report)';

  const seen = new Set<string>();
  const items: { fp: string; label: string }[] = [];
  for (const e of errors) {
    const fp = fingerprint(e);
    if (seen.has(fp)) continue;
    seen.add(fp);
    items.push({ fp, label: e.route || e.category });
  }

  const counts = historyFor(history, items.map((i) => i.fp));
  return items
    .map(({ fp, label }) => {
      const h = counts.get(fp);
      if (!h || h.count <= 1 || h.firstSeen === null) return `${label}: first time`;
      return `${label}: seen ${h.count} times this week, first ${formatDate(h.firstSeen)}`;
    })
    .join('\n');
}

export function buildDigest(input: TriageInput): string {
  const now = Date.now();
  const contextBlock = buildContextBlock(input.context);

  // clip() runs before pick()/dedupeEntries() so one absurdly long message
  // can't blow the budget on its own; the entries then flow straight into
  // buildTimeline/formatTimeline (T1's report libs) for rendering, the same
  // renderer the Discord embed's "Evidence" field uses (see route.ts).
  const clipMessage = <T extends { message: string }>(e: T): T => ({ ...e, message: clip(e.message, MAX_MESSAGE_CHARS) });

  const curEntries = dedupeEntries(pick(input.client.current, MAX_CLIENT_CURRENT).map(clipMessage));
  const prevEntries = input.client.previous.length > 0
    ? dedupeEntries(pick(input.client.previous, MAX_CLIENT_PREVIOUS).map(clipMessage))
    : [];
  const srvEntries = dedupeEntries(pick(input.server, MAX_SERVER).map(clipMessage));
  const desktopLines = input.desktopLog
    ? input.desktopLog.split('\n').filter((l) => l.length > 0).slice(-MAX_DESKTOP_LOG_LINES)
    : [];

  const seenBefore = formatSeenBefore(input.server, input.history ?? []);

  // maxLines is generous on purpose: pick() above already bounds how many
  // entries reach here (error-priority, capped per source), so this call
  // should never itself need to cut anything.
  const render = () => {
    const client = [
      ...curEntries,
      // Tag previous-session lines in the message itself: buildTimeline has
      // no separate "session" concept, and the tag keeps them identifiable
      // once merged into one chronological timeline with the current session.
      ...prevEntries.map((e) => ({ ...e, message: `${e.message}  [prev session]` })),
    ];
    const timelineText = formatTimeline(buildTimeline({ client, server: srvEntries, reportedAt: now, maxLines: 10_000 }));
    const desktopBlock = desktopLines.length > 0
      ? `\n\n## Desktop log tail (last ${desktopLines.length} lines)\n${desktopLines.join('\n')}`
      : '';
    return `${contextBlock}\n\n## Timeline\n${timelineText}\n\n## Seen before\n${seenBefore}${desktopBlock}`;
  };

  // The context block and the "Seen before" summary are never trimmed (both
  // small, both trustworthy regardless of log volume). If the rest is still
  // over budget: drop entries oldest-first (pick() already left each array
  // in chronological order), client sections before the server section
  // before the desktop tail, same priority as before this restructure: the
  // "what was happening" state and the newest events are worth more than an
  // old breadcrumb.
  let text = render();
  const shiftable: Array<{ length: number; shift: () => unknown }> = [curEntries, prevEntries, srvEntries, desktopLines];
  let si = 0;
  while (text.length > MAX_DIGEST_CHARS && si < shiftable.length) {
    const arr = shiftable[si];
    if (arr.length === 0) {
      si++;
      continue;
    }
    arr.shift();
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
position, online/offline, playback backend), a readable Timeline (an
"Errors" block first, then "Before it" for breadcrumbs, both in time order;
native-app events are tagged "native:<area>", and a server line sharing a
request id with a client line is nested under it as "server: ..." so you can
line up the two sides of one request), a "Seen before" line per distinct
server error telling you how often that same error has occurred in the past
week ("first time" for a brand-new one), and a desktop log tail on the Tauri
app. Work out what actually went wrong.

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

/** Called once at server startup (instrumentation.ts's register()). A
 *  missing key doesn't stop the app: triageBugReport() already degrades to
 *  null and the report still sends. But bug reports silently arriving with
 *  no diagnosis, forever, is confusing enough to deserve one clear line in
 *  the logs the moment the server boots, not a mystery discovered later. */
export function checkTriageConfig(): void {
  if (isTriageConfigured()) return;
  const message = 'ANTHROPIC_API_KEY is not set: bug reports will arrive without AI triage';
  serverLogger.warn('ai', message);
  console.warn(`[triage] ${message}`);
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
