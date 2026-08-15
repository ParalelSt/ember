import 'server-only';
import { z } from 'zod';
import type { LogEntry, ServerLogEntry } from '@/lib/logger/types';
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

const TriageSchema = z.object({
  summary: z.string().min(1).max(300),
  likelyCause: z.string().min(1).max(800),
  area: z.enum(AREAS).catch('unknown'),
  severity: z.enum(['low', 'medium', 'high']).catch('medium'),
  confidence: z.enum(['low', 'medium', 'high']).catch('low'),
  nextSteps: z.array(z.string().max(300)).max(4).default([]),
});

export type Triage = z.infer<typeof TriageSchema>;

export interface TriageInput {
  note: string;
  client: { current: LogEntry[]; previous: LogEntry[]; sessionId: string };
  server: ServerLogEntry[];
  userAgent: string;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stringifyData(data: unknown): string {
  if (data === undefined || data === null) return '';
  try {
    return ` ${clip(JSON.stringify(data), MAX_DATA_CHARS)}`;
  } catch {
    return '';
  }
}

/** One log entry → one line. Times are relative ("-12.4s") because absolute
 *  timestamps burn tokens and the ordering is what matters for diagnosis. */
function line(e: LogEntry, now: number): string {
  const age = ((e.ts - now) / 1000).toFixed(1);
  const head = `[${age}s] ${e.level === 'error' ? 'ERROR' : 'info'} ${e.category}: ${clip(e.message, MAX_MESSAGE_CHARS)}`;
  const stack = e.stack
    ? `\n    ${e.stack.split('\n').slice(0, MAX_STACK_LINES).map((l) => l.trim()).join('\n    ')}`
    : '';
  return head + stringifyData(e.data) + stack;
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

export function buildDigest(input: TriageInput): string {
  const now = Date.now();
  const sections: string[] = [];

  const cur = dedupe(pick(input.client.current, MAX_CLIENT_CURRENT).map((e) => line(e, now)));
  sections.push(`## Client log — current session (${input.client.current.length} events)\n${cur.join('\n') || '(none)'}`);

  if (input.client.previous.length > 0) {
    const prev = dedupe(pick(input.client.previous, MAX_CLIENT_PREVIOUS).map((e) => line(e, now)));
    sections.push(`## Client log — previous session (${input.client.previous.length} events)\n${prev.join('\n')}`);
  }

  const srv = dedupe(pick(input.server, MAX_SERVER).map((e) => line(e, now)));
  sections.push(`## Server log — last 5 minutes (${input.server.length} events)\n${srv.join('\n') || '(none)'}`);

  return clip(sections.join('\n\n'), MAX_DIGEST_CHARS);
}

const SYSTEM = `You triage bug reports for Ember, a self-hosted music streaming app.

Stack: Next.js App Router frontend, PocketBase for auth/data (pb_auth cookie),
a Python helper (yt-dlp + ytmusicapi) for YouTube Music search and audio, and a
server-side stream proxy that caches downloaded audio to disk. Known recurring
failure modes: YouTube 403s on expired stream URLs, PocketBase connection
errors, Python helper timeouts, and playback/queue state bugs.

You get the reporter's note (may be empty or vague) plus condensed client and
server logs. Work out what actually went wrong.

Reply with ONLY a JSON object, no prose and no code fences:
{
  "summary": "one sentence, what broke from the user's point of view",
  "likelyCause": "the technical cause, citing specific log evidence; say plainly if the logs don't show it",
  "area": one of ${AREAS.join(' | ')},
  "severity": "low" | "medium" | "high",
  "confidence": "low" | "medium" | "high",
  "nextSteps": ["up to 3 concrete things the maintainer should check first"]
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

  const digest = buildDigest(input);
  const prompt = [
    `Reporter's note: ${input.note || '(none given)'}`,
    `User-agent: ${input.userAgent}`,
    '',
    digest,
  ].join('\n');

  try {
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
