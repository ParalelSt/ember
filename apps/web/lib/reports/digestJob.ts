import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isTriageConfigured, summarizeDigest, type DigestSummary } from '@/lib/ai/triage';
import { logDir, serverLogger } from '@/lib/logger/server';
import { scrubServerEntry } from '@/lib/logger/sanitize';
import { formatDigest, groupForDigest, type DigestGroup } from '@/lib/reports/digest';
import { codeFields, DISCORD_FIELD_CHARS, remainingEmbedBudget, webhookUrl, type EmbedField } from '@/lib/reports/discord';

/** The daily error digest: one Discord message a day saying what broke,
 *  grouped by fingerprint so a hundred occurrences of one bug read as one
 *  line. Scheduled from instrumentation.ts and triggerable by hand from
 *  POST /api/admin/digest.
 *
 *  Best-effort throughout, like triage: a missing API key, a model failure
 *  or a rejected webhook post must never take the server down or spam
 *  Discord with retries. */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOUR = 8;
/** Groups posted in the Discord message itself. Every group is still in the
 *  attached digest.json; this keeps a pathological day (hundreds of distinct
 *  fingerprints) from producing an embed Discord rejects outright. */
const TOP_GROUPS = 20;
/** Embed stripe: red when any group escalated to an error, amber otherwise. */
const COLOR_ERROR = 0xef4444;
const COLOR_WARN = 0xfacc15;

export interface RunDigestOptions {
  /** Treated as "now"; defaults to Date.now(). */
  now?: number;
  /** Start of the window; defaults to 24 hours before `now`. */
  since?: number;
  /** Write the day's marker file so a restart does not repost. The scheduler
   *  sets this; the manual admin trigger deliberately does not, so it can be
   *  run repeatedly without consuming the day. */
  writeMarker?: boolean;
}

export interface DigestResult {
  posted: boolean;
  /** Why nothing was posted. Absent when `posted` is true. */
  reason?: 'quiet' | 'no-webhook' | 'post-failed';
  groups: DigestGroup[];
  summary: DigestSummary | null;
}

/** Hour of the host's local day the digest goes out. Out-of-range or
 *  unparseable values fall back to 8 rather than disabling the job. */
export function digestHour(): number {
  const raw = Number.parseInt(process.env.DIGEST_HOUR ?? '', 10);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : DEFAULT_HOUR;
}

/** Local, not UTC: the schedule is expressed in the host's local hours, so
 *  the marker has to be keyed the same way or a host far from UTC could post
 *  twice (or skip) across its own midnight. */
function localDay(now: Date): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** `logs/digest-YYYY-MM-DD.sent`: the "already done today" marker, next to
 *  the JSONL the digest reads. */
export function markerPath(now: Date): string {
  return path.join(logDir(), `digest-${localDay(now)}.sent`);
}

export async function markerExists(now: Date): Promise<boolean> {
  try {
    await fs.access(markerPath(now));
    return true;
  } catch {
    return false;
  }
}

async function writeMarkerFile(now: Date): Promise<void> {
  try {
    await fs.mkdir(logDir(), { recursive: true });
    await fs.writeFile(markerPath(now), `${new Date(now).toISOString()}\n`, 'utf8');
  } catch (e) {
    // A marker we could not write means at worst one extra digest later
    // today, which is much better than failing the run that already posted.
    console.warn('[digest] could not write the day marker', e);
  }
}

/** The whole schedule, as one pure function so it can be tested without a
 *  clock, a filesystem or a server: run once the local hour has arrived, and
 *  only if today's marker is not there yet. The caller ticks this every
 *  minute, so a host asleep at 08:00 still gets its digest when it wakes. */
export function shouldRunNow(now: Date, hour: number, markerExists: boolean): boolean {
  if (markerExists) return false;
  return now.getHours() >= hour;
}

/** The digest's own entries come straight off disk, so they get the same
 *  redaction pass the bug-report route applies before anything leaves the
 *  host. Only the group examples are scrubbed (the rest of a group is counts
 *  and timestamps), which keeps this to one pass over the groups rather than
 *  over every entry of the day. */
function scrubGroup(g: DigestGroup): DigestGroup {
  return { ...g, example: scrubServerEntry(g.example) };
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function runDigest(options: RunDigestOptions = {}): Promise<DigestResult> {
  const nowMs = options.now ?? Date.now();
  const since = options.since ?? nowMs - DAY_MS;

  const finish = async (result: DigestResult): Promise<DigestResult> => {
    // The marker is written on every path the scheduler reaches, including a
    // quiet day and a failed post: the alternative is re-reading a day of
    // JSONL (and possibly re-posting) every minute until midnight.
    if (options.writeMarker) await writeMarkerFile(new Date(nowMs));
    return result;
  };

  // Exactly one log read per run. entriesSince is uncached and walks every
  // day file in the window, so calling it twice would double a job that runs
  // unattended (T2 review note).
  const entries = await serverLogger.entriesSince(since);
  const groups = groupForDigest(entries, since).map(scrubGroup);
  if (groups.length === 0) {
    return finish({ posted: false, reason: 'quiet', groups: [], summary: null });
  }

  const top = groups.slice(0, TOP_GROUPS);
  const text = formatDigest(top, { since, until: nowMs });
  const summary = await summarizeDigest(text, groups.length);

  const url = webhookUrl();
  if (!url) return finish({ posted: false, reason: 'no-webhook', groups, summary });

  const posted = await post(url, { nowMs, since, text, groups, summary });
  return finish({ posted, reason: posted ? undefined : 'post-failed', groups, summary });
}

async function post(
  url: string,
  {
    nowMs,
    since,
    text,
    groups,
    summary,
  }: { nowMs: number; since: number; text: string; groups: DigestGroup[]; summary: DigestSummary | null },
): Promise<boolean> {
  const total = groups.reduce((n, g) => n + g.count, 0);
  const hidden = Math.max(0, groups.length - TOP_GROUPS);

  const footerParts = [
    `${total} event${total === 1 ? '' : 's'}, ${groups.length} distinct`,
    hidden > 0 ? `top ${TOP_GROUPS} shown, all ${groups.length} in digest.json` : null,
    // Say so rather than leaving the missing lines looking like a model that
    // had nothing to add.
    summary ? null : isTriageConfigured() ? 'AI summary unavailable' : 'no ANTHROPIC_API_KEY: no AI summary',
  ].filter((p): p is string => p !== null);

  const title = `Daily error digest ${localDay(new Date(nowMs))}`;
  const description = summary?.headline
    ? clip(summary.headline, 2000)
    : `${groups.length} distinct problem${groups.length === 1 ? '' : 's'} since yesterday.`;
  const footerText = footerParts.join(' · ');
  const whatToLookAt: EmbedField | null =
    summary && summary.lines.length > 0
      ? {
          name: 'What to look at',
          value: clip(summary.lines.map((l) => `• ${l}`).join('\n'), DISCORD_FIELD_CHARS),
          inline: false,
        }
      : null;

  // Same reasoning as the bug-report embed: everything but "Errors" is
  // sized first so "Errors" (codeFields' maxChars) only claims what's left
  // of the embed's 6000-character budget, rather than risking a rejected
  // post on a busy day.
  const usedChars =
    title.length +
    description.length +
    footerText.length +
    (whatToLookAt ? whatToLookAt.name.length + whatToLookAt.value.length : 0);
  const fields: EmbedField[] = [...codeFields('Errors', text, 6, remainingEmbedBudget(usedChars))];
  if (whatToLookAt) fields.push(whatToLookAt);

  const embed = {
    title,
    description,
    color: groups.some((g) => g.level === 'error') ? COLOR_ERROR : COLOR_WARN,
    timestamp: new Date(nowMs).toISOString(),
    footer: { text: footerText },
    fields,
  };

  const payload = {
    since: new Date(since).toISOString(),
    until: new Date(nowMs).toISOString(),
    groups,
    summary,
  };

  try {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embed] }));
    form.append(
      'files[0]',
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      'digest.json',
    );
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      serverLogger.error('digest', `Discord rejected the digest (${res.status})`, {
        detail: clip(detail, 300),
      });
      return false;
    }
    return true;
  } catch (e) {
    serverLogger.error('digest', 'posting the digest failed', undefined, e);
    return false;
  }
}
