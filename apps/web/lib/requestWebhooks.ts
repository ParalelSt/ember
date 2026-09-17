// Kept out of the route file: Next.js only allows route handlers (GET, POST,
// config) as exports from app/api/**/route.ts.

// Built-in channels, the same way the bug-report webhook ships in source, so
// every copy of Ember (friends self-hosting too) sends requests to the owner
// without extra setup. PASTE the two Discord webhook URLs between the quotes.
// DISCORD_FEATURE_WEBHOOK_URL / DISCORD_FIX_WEBHOOK_URL in .env.local win.
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
