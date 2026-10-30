import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { DISCORD_UNREACHABLE, postToDiscord, webhookUrl } from '@/lib/reports/discord';
import { serverLogger } from '@/lib/logger/server';
import { scrubText } from '@/lib/logger/sanitize';
import { reportVersionLabel, type VersionContext } from '@/lib/versions/label';

const MAX_NOTE_LEN = 1000;
const MAX_LYRICS_LEN = 4000;

interface RequestBody {
  trackTitle?: string;
  trackArtist?: string;
  source?: string;
  note?: string;
  lyrics?: string;
  context?: VersionContext;
}

export const POST = withRequestLog('lyrics-report', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();

    const limited = rateLimitResponse(`lyrics-report:${user.id}`, {
      windowMs: 10 * 60 * 1000,
      max: 5,
    });
    if (limited) return limited;

    // Read per call, not at module load: same reasoning as webhookUrl()'s
    // own doc comment (lib/reports/discord.ts), a route module can be
    // evaluated well before a test sets the env var for its case.
    const webhook = webhookUrl();
    if (!webhook) {
      return jsonError('Lyrics reporting is not configured on this server.', 503);
    }

    const body = (await request.json().catch(() => null)) as RequestBody | null;
    if (!body || !body.trackTitle) return jsonError('trackTitle is required', 400);

    const title = String(body.trackTitle).slice(0, 200);
    const artist = String(body.trackArtist ?? '').slice(0, 200);
    const source = String(body.source ?? 'unknown').slice(0, 32);
    // Scrubbed like the bug report's and the request's: a person can paste
    // anything.
    const note = scrubText(String(body.note ?? '')).slice(0, MAX_NOTE_LEN).trim();
    const lyricsSnippet = String(body.lyrics ?? '').slice(0, MAX_LYRICS_LEN);

    const embed = {
      title: `Lyrics report - ${title}`,
      description: note ? `> ${note.split('\n').join('\n> ')}` : '_(no note)_',
      color: 0xff5a3a,
      timestamp: new Date().toISOString(),
      fields: [
        { name: 'Artist', value: artist || '_(unknown)_', inline: true },
        { name: 'Source', value: source, inline: true },
        { name: 'Reporter', value: user.email, inline: true },
        { name: 'Version', value: reportVersionLabel(body.context), inline: false },
      ],
    };

    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embed] }));
    if (lyricsSnippet) {
      const fileBlob = new Blob([lyricsSnippet], { type: 'text/plain' });
      form.append('files[0]', fileBlob, 'lyrics.txt');
    }

    const discordRes = await postToDiscord(webhook, { method: 'POST', body: form });
    if (!discordRes.ok) {
      // The detail (undici's network error, Discord's own body) is for the
      // logs; the person gets a sentence.
      const text = await discordRes.text().catch(() => '');
      serverLogger.error('api', 'lyrics-report: Discord rejected the report', {
        status: discordRes.status,
        detail: text.slice(0, 200),
      });
      return jsonError(
        discordRes.status === DISCORD_UNREACHABLE
          ? "Couldn't reach Discord, please try again"
          : "Couldn't send the report, please try again",
        502,
      );
    }

    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
