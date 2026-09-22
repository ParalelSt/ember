import type { NextRequest } from "next/server";
import {
  requireUser,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/auth";
import { serverLogger } from "@/lib/logger/server";
import { rateLimitResponse } from "@/lib/rateLimit";
import { fromError, jsonError } from "@/lib/upsertTrack";
import { withRequestLog } from "@/lib/logger/withRequestLog";
import { scrubText } from "@/lib/logger/sanitize";
import { resolveWebhook } from "@/lib/requestWebhooks";
import { readReportBody } from "@/lib/reports/readBody";
import {
  droppedAttachmentsField,
  isTooLargeForDiscord,
  safeAttachmentName,
} from "@/lib/attachments";

const MAX_NAME_LEN = 80;
const MAX_MAIN_LEN = 2000;
const MAX_EXTRA_LEN = 2000;
// Same reasoning as bug-report's MAX_CONTEXT_STRING_LEN: bounds a client-
// supplied context string so a hand-crafted body can't bloat the embed.
const MAX_CONTEXT_STRING_LEN = 200;

const KINDS = ["feature", "fix"] as const;
type Kind = (typeof KINDS)[number];

// Ember orange for a feature request, a distinct blue for a fix: lets the
// channel be skimmed by colour alone.
const EMBED_COLOR: Record<Kind, number> = {
  feature: 0xff5a3a,
  fix: 0x3a82f7,
};

interface RequestContext {
  appVersion?: string;
  shell?: string;
  route?: string;
  platform?: string;
}

interface RequestBody {
  kind?: Kind;
  name?: string;
  main?: string;
  extra?: string;
  context?: RequestContext;
}

/** Same shape of validation as bug-report's sanitizeContext: drop anything
 *  that isn't a plain object rather than rejecting the request, and cap
 *  every string field so a hand-written body can't blow up the embed. */
function sanitizeContext(ctx: unknown): RequestContext | undefined {
  if (ctx === null || ctx === undefined) return undefined;
  if (typeof ctx !== "object" || Array.isArray(ctx)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v.slice(0, MAX_CONTEXT_STRING_LEN) : v;
  }
  return out as RequestContext;
}

/** Discord caps a field/description at these lengths; truncate with an
 *  ellipsis rather than letting the webhook reject the whole embed. */
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const POST = withRequestLog("requests", async (request: NextRequest) => {
  try {
    const { user } = await requireUser();

    const limited = rateLimitResponse(`requests:${user.id}`, {
      max: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const parsed = await readReportBody<RequestBody>(request);
    if (!parsed.ok) return jsonError(parsed.error ?? "Invalid request body", 400);
    const { body, files } = parsed;

    const kind = body.kind;
    if (kind !== "feature" && kind !== "fix") {
      return jsonError("kind must be 'feature' or 'fix'", 400);
    }

    const name = String(body.name ?? "").trim();
    if (name.length < 1 || name.length > MAX_NAME_LEN) {
      return jsonError(`name must be 1-${MAX_NAME_LEN} characters`, 400);
    }

    const main = String(body.main ?? "").trim();
    if (main.length < 1 || main.length > MAX_MAIN_LEN) {
      return jsonError(`that field must be 1-${MAX_MAIN_LEN} characters`, 400);
    }

    const extraRaw = String(body.extra ?? "").trim();
    if (extraRaw.length > MAX_EXTRA_LEN) {
      return jsonError(`extra must be at most ${MAX_EXTRA_LEN} characters`, 400);
    }

    const target = resolveWebhook(kind, user.email);
    if (target.skip) {
      return Response.json({ ok: true, skipped: "test account" });
    }
    const webhookUrl = target.url;
    if (!webhookUrl) {
      return jsonError("Requests are not set up on this server", 503);
    }

    const context = sanitizeContext(body.context);

    // Scrub every text field: a pasted token or cookie in the description
    // must never reach the webhook payload.
    const scrubbedName = scrubText(name);
    const scrubbedMain = scrubText(main);
    const scrubbedExtra = extraRaw ? scrubText(extraRaw) : "";

    const title =
      kind === "feature" ? `New feature: ${scrubbedName}` : `Fix: ${scrubbedName}`;

    const footerParts = [
      user.email,
      context?.appVersion,
      context?.shell,
      context?.route,
    ].filter((p): p is string => typeof p === "string" && p.length > 0);

    const fields = scrubbedExtra
      ? [{ name: "Anything else", value: truncate(scrubbedExtra, 1024) }]
      : [];

    const embed = {
      title: truncate(title, 256),
      description: truncate(scrubbedMain, 4096),
      color: EMBED_COLOR[kind],
      fields,
      footer: footerParts.length ? { text: footerParts.join(" · ") } : undefined,
    };

    // JSON exactly as before; with screenshots or clips, multipart so they
    // land on the same message as real attachments.
    const send = (withFiles: boolean) => {
      if (files.length === 0) {
        return fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
        });
      }
      const sentEmbed = withFiles ? embed : { ...embed, fields: [...fields, droppedAttachmentsField(files)] };
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ embeds: [sentEmbed], allowed_mentions: { parse: [] } }));
      if (withFiles) {
        files.forEach((f, i) => form.append(`files[${i}]`, f, safeAttachmentName(f.name, i)));
      }
      return fetch(webhookUrl, { method: "POST", body: form });
    };

    let discordRes = await send(true);
    // Discord's size limit can be lower than ours (it depends on the
    // server's boosts): rather than lose the request, send it once more
    // without the files and say so in the embed.
    let attachmentsDropped = false;
    if (!discordRes.ok && files.length > 0) {
      const text = await discordRes.text().catch(() => "");
      if (isTooLargeForDiscord(discordRes.status, text)) {
        attachmentsDropped = true;
        discordRes = await send(false);
      }
    }

    if (!discordRes.ok) {
      serverLogger.error("api", "requests: Discord rejected the request", {
        status: discordRes.status,
      });
      return jsonError("Couldn't send the request, please try again", 502);
    }

    if (attachmentsDropped) return Response.json({ ok: true, attachmentsDropped });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
