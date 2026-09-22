/** The one Discord channel every report goes to, and the field-splitting
 *  every long code block needs to survive Discord's caps. Shared by the
 *  bug-report route and the daily digest so the baked-in webhook URL and the
 *  1024-char chunking exist exactly once. */

// Default webhook so every deployment, including friends self-hosting, sends
// reports to the project owner's Discord channel. The env var still wins for
// local testing. Webhook URLs are low-sensitivity (write-only, channel-
// scoped); if this one ever gets abused, delete + recreate it in Discord
// (Server Settings, Integrations, Webhooks) and rebuild.
const DEFAULT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1512120864391565333/wbnK9NOCeqbHNPK_k8UcdFxRZKztm0LfBR1OfKIQ2txf1zAPwF4mp4kII1S3SA7MIUPY';

/** Read on every call rather than captured at module load: the digest runs
 *  from a timer long after boot, and tests set the variable per case. */
export function webhookUrl(): string {
  return process.env.DISCORD_BUG_REPORT_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
}

/** True when no deployment-specific webhook was configured, so anything sent
 *  lands in the project owner's channel. Sandboxes use this to refuse to
 *  forward test traffic there. */
export function usingDefaultWebhook(): boolean {
  return !process.env.DISCORD_BUG_REPORT_WEBHOOK_URL;
}

/** Discord's per-field value cap. */
export const DISCORD_FIELD_CHARS = 1024;

/** Discord rejects an embed whose title, description, fields and footer
 *  together exceed this many characters (not just each field on its own). */
export const DISCORD_EMBED_CHARS = 6000;

/** Left un-budgeted on purpose: a cushion against off-by-one counting (does
 *  a fence's own characters count the same on Discord's side, emoji width,
 *  etc.) so a report lands a little short of the wall rather than getting
 *  rejected by it. */
const DISCORD_EMBED_MARGIN = 200;

export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

/** How much of the 6000-character embed budget is left for one growing
 *  field once everything else in the embed (title, description, the other
 *  fields, footer) is accounted for. `used` is the character count of all
 *  of that other content; callers pass the result straight into
 *  `codeFields`'s `maxChars`. Never negative: a caller that is already over
 *  budget on the fixed parts gets 0, and `codeFields` degrades to an empty
 *  or minimal field rather than throwing. */
export function remainingEmbedBudget(used: number): number {
  return Math.max(0, DISCORD_EMBED_CHARS - DISCORD_EMBED_MARGIN - used);
}

/** One or more fields carrying `text` as a fenced code block, split on whole
 *  lines so a stack frame or digest entry is never cut mid-line. Named
 *  "<name>", "<name> (cont.)", "<name> (cont. 2)", ... An embed may hold at
 *  most 25 fields in total, so callers pass `maxFields` to leave room for
 *  their own; anything past it is dropped with a final "(N more lines)"
 *  marker rather than making Discord reject the whole message.
 *
 *  `maxChars`, when given, is a second, whole-embed budget (see
 *  `remainingEmbedBudget`): once the fields built so far would push the
 *  embed over it, the field that doesn't fit is truncated with the same
 *  "(N more lines omitted)" marker and anything after it is dropped, rather
 *  than silently building an embed Discord rejects outright. */
export function codeFields(name: string, text: string, maxFields = 6, maxChars?: number): EmbedField[] {
  const fence = '```\n';
  const budget = DISCORD_FIELD_CHARS - fence.length * 2;
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';
  let dropped = 0;
  for (const l of lines) {
    if (chunks.length >= maxFields) {
      dropped++;
      continue;
    }
    const candidate = current ? `${current}\n${l}` : l;
    if (candidate.length > budget && current) {
      chunks.push(current);
      current = l;
    } else {
      current = candidate;
    }
  }
  if (current && chunks.length < maxFields) chunks.push(current);
  else if (current) dropped += current.split('\n').length;
  if (chunks.length === 0) chunks.push('(none)');
  if (dropped > 0) {
    const marker = `\n(${dropped} more line${dropped === 1 ? '' : 's'} omitted)`;
    const last = chunks.length - 1;
    chunks[last] = `${chunks[last].slice(0, budget - marker.length)}${marker}`;
  }

  const fieldName = (i: number) => (i === 0 ? name : `${name} (cont.${i > 1 ? ` ${i}` : ''})`);
  const toField = (chunk: string, i: number): EmbedField => ({
    name: fieldName(i),
    value: `${fence}${chunk}\n\`\`\``,
    inline: false,
  });

  if (maxChars === undefined) return chunks.map(toField);

  // Second pass: keep whole fields while the running total still fits the
  // whole-embed budget; the first one that doesn't gets truncated in place
  // (folding every line it and any later field would have carried into one
  // "more lines omitted" marker) and nothing after it is emitted.
  const fields: EmbedField[] = [];
  let used = 0;
  for (let i = 0; i < chunks.length; i++) {
    const f = toField(chunks[i], i);
    const cost = f.name.length + f.value.length;
    if (used + cost <= maxChars) {
      fields.push(f);
      used += cost;
      continue;
    }
    const extraDropped = chunks.slice(i).reduce((n, c) => n + c.split('\n').length, 0);
    const marker = `\n(${extraDropped} more line${extraDropped === 1 ? '' : 's'} omitted)`;
    const room = maxChars - used - f.name.length - fence.length * 2 - marker.length;
    if (room > 0) fields.push({ ...f, value: `${fence}${chunks[i].slice(0, room)}${marker}\n\`\`\`` });
    break;
  }
  return fields;
}

/** Status for a webhook POST that never got an answer (DNS, refused, TLS,
 *  offline host): not an HTTP code, so it can never be mistaken for one. */
export const DISCORD_UNREACHABLE = 599;

/** fetch() for the webhook that never throws: a network failure comes back
 *  as a DISCORD_UNREACHABLE response, so each route answers the person with
 *  its own sentence instead of leaking undici's bare "fetch failed". */
export function postToDiscord(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init).catch(
    (e: unknown) =>
      new Response(`unreachable: ${(e as Error)?.message ?? 'network error'}`, { status: DISCORD_UNREACHABLE }),
  );
}
