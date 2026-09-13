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

export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

/** One or more fields carrying `text` as a fenced code block, split on whole
 *  lines so a stack frame or digest entry is never cut mid-line. Named
 *  "<name>", "<name> (cont.)", "<name> (cont. 2)", ... An embed may hold at
 *  most 25 fields in total, so callers pass `maxFields` to leave room for
 *  their own; anything past it is dropped with a final "(N more lines)"
 *  marker rather than making Discord reject the whole message. */
export function codeFields(name: string, text: string, maxFields = 6): EmbedField[] {
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
  return chunks.map((chunk, i) => ({
    name: i === 0 ? name : `${name} (cont.${i > 1 ? ` ${i}` : ''})`,
    value: `${fence}${chunk}\n\`\`\``,
    inline: false,
  }));
}
