// Kept out of the route file: Next.js only allows route handlers (GET, POST,
// config) as exports from app/api/**/route.ts.

// Webhooks are env-only, never committed (see lib/reports/discord.ts's doc
// comment): DISCORD_FEATURE_WEBHOOK_URL / DISCORD_FIX_WEBHOOK_URL in
// apps/web/.env.local. This stays empty on purpose; resolveWebhook() below
// treats an unset kind as "not configured" and callers return a 503.
export const DEFAULT_WEBHOOKS: Record<"feature" | "fix", string> = {
  feature: "",
  fix: "",
};

/** Picks the webhook for a request. Test suites sign in as throwaway
 *  @ember.test accounts; when a server has no webhook of its own their
 *  requests would land in the owner's real channels, so those are skipped
 *  (same rule as bug reports). */
export function resolveWebhook(
  kind: "feature" | "fix",
  email: string,
  env: Record<string, string | undefined> = process.env,
  defaults: Record<"feature" | "fix", string> = DEFAULT_WEBHOOKS,
): { url: string; skip: boolean } {
  const envUrl = kind === "feature" ? env.DISCORD_FEATURE_WEBHOOK_URL : env.DISCORD_FIX_WEBHOOK_URL;
  if (envUrl) return { url: envUrl, skip: false };
  const url = defaults[kind];
  return { url, skip: !!url && email.toLowerCase().endsWith("@ember.test") };
}
