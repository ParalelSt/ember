import type { NextRequest } from "next/server";
import {
  requireUser,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/auth";
import { serverLogger } from "@/lib/logger/server";
import type { ClientSnapshot } from "@/lib/logger/types";
import { fromError, jsonError } from "@/lib/upsertTrack";

const REPORT_WINDOW_MS = 5 * 60 * 1000;
const MAX_NOTE_LEN = 1000;

// Default webhook so every deployment — including friends self-hosting — sends
// bug reports to the project owner's Discord channel. The env var still wins
// for local testing. Webhook URLs are low-sensitivity (write-only, channel-
// scoped); if this one ever gets abused, delete + recreate it in Discord
// (Server Settings → Integrations → Webhooks) and rebuild.
const DEFAULT_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1512120864391565333/wbnK9NOCeqbHNPK_k8UcdFxRZKztm0LfBR1OfKIQ2txf1zAPwF4mp4kII1S3SA7MIUPY";
const WEBHOOK_URL =
  process.env.DISCORD_BUG_REPORT_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

interface RequestBody {
  note?: string;
  client?: ClientSnapshot;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();

    if (!WEBHOOK_URL) {
      return jsonError(
        "Bug reporting not configured. Paste a Discord webhook URL into DEFAULT_WEBHOOK_URL in app/api/bug-report/route.ts, or set DISCORD_BUG_REPORT_WEBHOOK_URL in .env.local.",
        503,
      );
    }

    const body = (await request.json().catch(() => null)) as RequestBody | null;
    if (
      !body ||
      !body.client ||
      !Array.isArray(body.client.current) ||
      !Array.isArray(body.client.previous)
    ) {
      return jsonError("Invalid report body", 400);
    }
    const note = String(body.note ?? "")
      .slice(0, MAX_NOTE_LEN)
      .trim();
    const client = body.client;

    const server = await serverLogger.recentSince(
      Date.now() - REPORT_WINDOW_MS,
    );

    const userAgent = request.headers.get("user-agent") ?? "unknown";
    const reportedAt = new Date().toISOString();

    const counts = {
      client_current: client.current.length,
      client_previous: client.previous.length,
      client_errors_current: client.current.filter((e) => e.kind === "error")
        .length,
      client_errors_previous: client.previous.filter((e) => e.kind === "error")
        .length,
      server_errors: server.length,
    };

    const payload = {
      reportedAt,
      reporter: { id: user.id, email: user.email },
      userAgent,
      note: note || null,
      sessionId: client.sessionId,
      counts,
      client,
      server,
    };

    const fileBlob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });

    const embed = {
      title: `Bug report from ${user.email}`,
      description: note || "_(no note)_",
      color: 0xff5a3a,
      timestamp: reportedAt,
      fields: [
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

    const discordRes = await fetch(WEBHOOK_URL, { method: "POST", body: form });
    if (!discordRes.ok) {
      const text = await discordRes.text().catch(() => "");
      return jsonError(
        `Discord rejected the report (${discordRes.status}): ${text.slice(0, 200)}`,
        502,
      );
    }

    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
