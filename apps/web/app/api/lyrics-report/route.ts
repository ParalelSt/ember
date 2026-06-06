import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { fromError, jsonError } from '@/lib/upsertTrack';

// Same channel as bug reports so the project owner gets every report in
// one place. Same env-var override pattern (see bug-report/route.ts).
const DEFAULT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1512120864391565333/wbnK9NOCeqbHNPK_k8UcdFxRZKztm0LfBR1OfKIQ2txf1zAPwF4mp4kII1S3SA7MIUPY';
const WEBHOOK_URL = process.env.DISCORD_BUG_REPORT_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

const MAX_NOTE_LEN = 1000;
const MAX_LYRICS_LEN = 4000;

interface RequestBody {
  trackTitle?: string;
  trackArtist?: string;
  source?: string;
  note?: string;
  lyrics?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();

    const limited = rateLimitResponse(`lyrics-report:${user.id}`, {
      windowMs: 10 * 60 * 1000,
      max: 5,
    });
    if (limited) return limited;

    if (!WEBHOOK_URL) {
      return jsonError('Lyrics reporting not configured — no Discord webhook set.', 503);
    }

    const body = (await request.json().catch(() => null)) as RequestBody | null;
    if (!body || !body.trackTitle) return jsonError('trackTitle is required', 400);

    const title = String(body.trackTitle).slice(0, 200);
    const artist = String(body.trackArtist ?? '').slice(0, 200);
    const source = String(body.source ?? 'unknown').slice(0, 32);
    const note = String(body.note ?? '').slice(0, MAX_NOTE_LEN).trim();
    const lyricsSnippet = String(body.lyrics ?? '').slice(0, MAX_LYRICS_LEN);

    const embed = {
      title: `Lyrics report — ${title}`,
      description: note ? `> ${note.split('\n').join('\n> ')}` : '_(no note)_',
      color: 0xff5a3a,
      timestamp: new Date().toISOString(),
      fields: [
        { name: 'Artist', value: artist || '_(unknown)_', inline: true },
        { name: 'Source', value: source, inline: true },
        { name: 'Reporter', value: user.email, inline: true },
      ],
    };

    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embed] }));
    if (lyricsSnippet) {
      const fileBlob = new Blob([lyricsSnippet], { type: 'text/plain' });
      form.append('files[0]', fileBlob, 'lyrics.txt');
    }

    const discordRes = await fetch(WEBHOOK_URL, { method: 'POST', body: form });
    if (!discordRes.ok) {
      const text = await discordRes.text().catch(() => '');
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
