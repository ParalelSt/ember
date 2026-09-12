import type { NextRequest } from "next/server";
import {
  requireUser,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/auth";
import { serverLogger } from "@/lib/logger/server";
import type { ClientSnapshot, ReportContext, ServerLogEntry } from "@/lib/logger/types";
import { rateLimitResponse } from "@/lib/rateLimit";
import { formatSeenBefore, triageBugReport } from "@/lib/ai/triage";
import { fromError, jsonError } from "@/lib/upsertTrack";
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { scrubText } from "@/lib/logger/sanitize";
import { buildTimeline, formatTimeline } from "@/lib/reports/timeline";

const REPORT_WINDOW_MS = 5 * 60 * 1000;
// How far back "Seen before" looks to tell "this has been happening all
// week" from "brand new": see formatSeenBefore in lib/ai/triage.ts.
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Discord's field value cap is 1024 chars; the "Evidence" code block gets
// a second (or third...) field instead of being truncated, since a cut-off
// stack frame is worse than a slightly longer message.
const DISCORD_FIELD_CHARS = 1024;
const MAX_NOTE_LEN = 1000;
// Sane ceiling for individual context strings (route, platform, language,
// …): a client that sends something absurd here shouldn't blow up the
// digest or the Discord embed, and it's still plenty for any real value.
const MAX_CONTEXT_STRING_LEN = 300;
// The desktop tail is capped at 200 lines natively; this is the belt-and-braces
// bound on a body the client could have hand-written, and keeps the Discord
// attachment well under the 8 MB upload limit.
const MAX_DESKTOP_LOG = 200_000;

/** Embed stripe colour by AI severity; the default ember orange when there's
 *  no triage. */
const SEVERITY_COLORS = {
  low: 0x4ade80,
  medium: 0xfacc15,
  high: 0xef4444,
} as const;

// Default webhook so every deployment — including friends self-hosting — sends
// bug reports to the project owner's Discord channel. The env var still wins
// for local testing. Webhook URLs are low-sensitivity (write-only, channel-
// scoped); if this one ever gets abused, delete + recreate it in Discord
// (Server Settings → Integrations → Webhooks) and rebuild.
const DEFAULT_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1512120864391565333/wbnK9NOCeqbHNPK_k8UcdFxRZKztm0LfBR1OfKIQ2txf1zAPwF4mp4kII1S3SA7MIUPY";
const WEBHOOK_URL =
  process.env.DISCORD_BUG_REPORT_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
const USING_DEFAULT_WEBHOOK = !process.env.DISCORD_BUG_REPORT_WEBHOOK_URL;

/** Test suites sign in as throwaway `@ember.test` accounts. A sandbox started
 *  without its own webhook must never forward their reports to the real
 *  channel; the host always sets DISCORD_BUG_REPORT_WEBHOOK_URL explicitly. */
function isSandboxReporter(email: string): boolean {
  return USING_DEFAULT_WEBHOOK && email.toLowerCase().endsWith("@ember.test");
}

/** One compact line for the Discord embed: the full per-field breakdown
 *  goes into the AI prompt (lib/ai/triage.ts's "State when reported" block);
 *  this is the human-skimmable version. */
function formatContextCompact(ctx: Partial<ReportContext> | undefined): string {
  if (!ctx) return "(no context)";
  const parts: string[] = [];
  const shellVersion = [ctx.shell, ctx.appVersion].filter(Boolean).join(" ");
  if (shellVersion) parts.push(shellVersion);
  if (ctx.route) parts.push(ctx.route);
  parts.push(ctx.online === false ? "offline" : "online");
  parts.push(
    ctx.track ? `playing ${ctx.track.source}:${ctx.track.id}` : "nothing playing",
  );
  if (ctx.queue && ctx.queue.length > 0) parts.push(`queue ${ctx.queue.index + 1}/${ctx.queue.length}`);
  return parts.join(", ");
}

interface RequestBody {
  note?: string;
  client?: ClientSnapshot;
  /** Set by lib/autoReport.ts for a silent crash report (T3). Rate-limited
   *  and triaged separately from a human-submitted report; never trusted
   *  beyond "is it truthy" (a forged flag just means someone's manual report
   *  gets the cheaper model and a different Discord title, not a security
   *  issue). */
  automatic?: boolean;
}

/** Validate `client.context`: must be a plain object when present (an old
 *  or malformed client could send anything, e.g. a track field sent as a
 *  bare string), and every string field is capped so one huge value can't
 *  bloat the digest or the Discord embed. Never rejects the report: a bad
 *  context is dropped, not fatal. */
function sanitizeContext(ctx: unknown): ReportContext | undefined {
  if (ctx === null || ctx === undefined) return undefined;
  if (typeof ctx !== "object" || Array.isArray(ctx)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v.slice(0, MAX_CONTEXT_STRING_LEN) : v;
  }
  return out as unknown as ReportContext;
}

/** Unlike the client snapshot (already run through `scrub` on the device),
 *  the server log window travels straight from disk: scrub it before it's
 *  attached to Discord or handed to triage. `userId` is left alone: it's a
 *  PocketBase id the host already owns, not a secret (see SETUP.md). */
function scrubServerEntry(e: ServerLogEntry): ServerLogEntry {
  let data = e.data;
  if (data !== undefined && data !== null) {
    try {
      data = JSON.parse(scrubText(JSON.stringify(data)));
    } catch {
      data = scrubText(String(data));
    }
  }
  return {
    ...e,
    message: scrubText(e.message),
    stack: e.stack ? scrubText(e.stack) : e.stack,
    data,
  };
}

export const POST = withRequestLog('bug-report', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();

    const body = (await request.json().catch(() => null)) as RequestBody | null;
    if (
      !body ||
      !body.client ||
      !Array.isArray(body.client.current) ||
      !Array.isArray(body.client.previous)
    ) {
      return jsonError("Invalid report body", 400);
    }
    // Never trust the flag beyond "is it truthy": it only picks a rate-limit
    // bucket, a triage model and a Discord title, none of which are a
    // security boundary (see the RequestBody doc comment above).
    const automatic = body.automatic === true;

    // Automatic (lib/autoReport.ts) and manual reports get separate limits:
    // a human hitting Submit twice by accident is a 30s cooldown, while
    // autoReport.ts already caps itself at 3 per browser session but that
    // cap is client-side and per-tab, so the server enforces its own
    // per-hour ceiling per user across every tab/device.
    const limited = automatic
      ? rateLimitResponse(`bug-report:auto:${user.id}`, { windowMs: 60 * 60 * 1000, max: 3 })
      : rateLimitResponse(`bug-report:${user.id}`, { windowMs: 30 * 1000, max: 1 });
    if (limited) return limited;

    if (!WEBHOOK_URL) {
      return jsonError(
        "Bug reporting not configured. Paste a Discord webhook URL into DEFAULT_WEBHOOK_URL in app/api/bug-report/route.ts, or set DISCORD_BUG_REPORT_WEBHOOK_URL in .env.local.",
        503,
      );
    }

    const note = String(body.note ?? "")
      .slice(0, MAX_NOTE_LEN)
      .trim();
    // The desktop log travels inside the client snapshot but goes out as its
    // own attachment, so strip it here: inlined it would also sit in
    // report.json, doubling the payload for no extra information.
    const { desktopLog: rawDesktopLog, ...clientRest } = body.client;
    const client = { ...clientRest, context: sanitizeContext(clientRest.context) };
    const desktopLog =
      typeof rawDesktopLog === "string" ? rawDesktopLog.slice(-MAX_DESKTOP_LOG) : "";

    const server = (
      await serverLogger.recentSince(Date.now() - REPORT_WINDOW_MS)
    ).map(scrubServerEntry);
    // Wider window, counts only: how often has each error fingerprint in
    // this report shown up in the last week (formatSeenBefore, shared with
    // the triage prompt below). Never displayed verbatim, so it doesn't need
    // scrubServerEntry's redaction pass.
    const history = await serverLogger.entriesSince(Date.now() - HISTORY_WINDOW_MS);

    const userAgent = request.headers.get("user-agent") ?? "unknown";
    const reportedAtMs = Date.now();
    const reportedAt = new Date(reportedAtMs).toISOString();

    const counts = {
      client_current: client.current.length,
      client_previous: client.previous.length,
      client_errors_current: client.current.filter((e) => e.kind === "error")
        .length,
      client_errors_previous: client.previous.filter((e) => e.kind === "error")
        .length,
      server_errors: server.length,
    };

    // Ask Claude what went wrong. Best-effort: null when there's no API key
    // or the call fails, and the report goes out exactly as it did before.
    const triage = await triageBugReport({
      note,
      client,
      server,
      userAgent,
      context: client.context,
      desktopLog,
      history,
      automatic,
    });

    const payload = {
      reportedAt,
      reporter: { id: user.id, email: user.email },
      userAgent,
      note: note || null,
      sessionId: client.sessionId,
      counts,
      triage,
      client,
      server,
    };

    const fileBlob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });

    // Discord caps a field value at 1024 characters. Most fields here are
    // short by construction and just get a safety truncation; "Evidence"
    // (the timeline) is the one field long enough to actually hit the cap
    // in practice, so it gets split across fields instead (see below).
    const field = (name: string, value: string, inline = false) => ({
      name,
      value: value.length > DISCORD_FIELD_CHARS ? `${value.slice(0, DISCORD_FIELD_CHARS - 3)}...` : value,
      inline,
    });

    // One or more fields carrying `text` as a fenced code block, split on
    // whole lines so a stack frame or timeline entry is never cut mid-line.
    // Named "Evidence", "Evidence (cont.)", "Evidence (cont. 2)", ...
    function codeFields(name: string, text: string): { name: string; value: string; inline: boolean }[] {
      const fence = "```\n";
      const budget = DISCORD_FIELD_CHARS - fence.length * 2;
      const lines = text.split("\n");
      const chunks: string[] = [];
      let current = "";
      for (const l of lines) {
        const candidate = current ? `${current}\n${l}` : l;
        if (candidate.length > budget && current) {
          chunks.push(current);
          current = l;
        } else {
          current = candidate;
        }
      }
      if (current) chunks.push(current);
      if (chunks.length === 0) chunks.push("(none)");
      return chunks.map((chunk, i) => ({
        name: i === 0 ? name : `${name} (cont.${i > 1 ? ` ${i}` : ""})`,
        value: `${fence}${chunk}\n\`\`\``,
        inline: false,
      }));
    }

    // Same renderer as the "Evidence" code block below feeds the AI prompt
    // (lib/ai/triage.ts's buildDigest), so the maintainer and the model
    // reason over the same events.
    const timelineText = formatTimeline(
      buildTimeline({ client: client.current, server, reportedAt: reportedAtMs, maxLines: 25 }),
    );
    const seenBeforeText = formatSeenBefore(server, history);

    const whatBroke = triage?.summary || note || "(no note)";
    // Footer carries severity/area/confidence (when triaged) plus an
    // "automatic" marker so a maintainer can tell a silent crash report
    // (lib/autoReport.ts) from one a person chose to send, at a glance.
    const footerParts = [
      triage ? `severity: ${triage.severity}` : null,
      triage ? `area: ${triage.area}` : null,
      triage ? `confidence: ${triage.confidence}` : null,
      automatic ? "automatic" : null,
    ].filter((p): p is string => p !== null);
    const embed = {
      title: `${automatic ? "Automatic report" : "Bug report"} from ${user.email}`,
      description: note || "_(no note)_",
      color: triage ? SEVERITY_COLORS[triage.severity] : 0xff5a3a,
      timestamp: reportedAt,
      footer: footerParts.length > 0 ? { text: footerParts.join(" · ") } : undefined,
      fields: [
        field("What broke", whatBroke),
        { name: "Where", value: formatContextCompact(client.context), inline: false },
        ...codeFields("Evidence", timelineText),
        field("Seen before", seenBeforeText),
        ...(triage
          ? [
              field("Reproduce", triage.reproduction),
              ...(triage.nextSteps.length
                ? [field("Check first", triage.nextSteps.map((s) => `• ${s}`).join("\n"))]
                : []),
            ]
          : []),
        {
          name: "Client errors",
          value: `${counts.client_errors_current} now / ${counts.client_errors_previous} prev`,
          inline: true,
        },
        {
          name: "Server errors",
          value: String(counts.server_errors),
          inline: true,
        },
        {
          name: "Breadcrumbs",
          value: `${counts.client_current} now / ${counts.client_previous} prev`,
          inline: true,
        },
        { name: "Session", value: "`" + client.sessionId + "`", inline: false },
        { name: "User-agent", value: userAgent.slice(0, 1000), inline: false },
      ],
    };

    const form = new FormData();
    form.append("payload_json", JSON.stringify({ embeds: [embed] }));
    form.append("files[0]", fileBlob, "report.json");
    if (desktopLog) {
      form.append(
        "files[1]",
        new Blob([desktopLog], { type: "text/plain" }),
        "desktop.log",
      );
    }

    if (isSandboxReporter(user.email)) {
      return Response.json({ ok: true, skipped: "test account", triage });
    }
    const discordRes = await fetch(WEBHOOK_URL, { method: "POST", body: form });
    if (!discordRes.ok) {
      const text = await discordRes.text().catch(() => "");
      return jsonError(
        `Discord rejected the report (${discordRes.status}): ${text.slice(0, 200)}`,
        502,
      );
    }

    // The reporter sees the diagnosis too — it tells them their report was
    // understood, and sometimes it's something they can fix themselves.
    return Response.json({ ok: true, triage });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
