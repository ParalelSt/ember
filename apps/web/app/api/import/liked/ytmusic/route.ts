import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { createAdminClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { redactSecrets } from '@/lib/import/redact';
import { createImportJob } from '@/lib/import/store';
import { kickImportRunner } from '@/lib/import/runnerInstance';
import { checkPastedHeaders, normalisePastedHeaders, parseYtmusicLiked } from '@/lib/import/sources/ytmusicLiked';
import { fetchLikedSongs } from '@/lib/sources/youtube';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The person's own liked songs on YouTube Music, on their way into Ember's
 *  likes.
 *
 *    POST /api/import/liked/ytmusic?preview=1   read the list and say what is in it
 *    POST /api/import/liked/ytmusic             read it and queue the transfer
 *
 *  Body: `{ secret, preview? }`. `secret` is the request headers of a
 *  signed-in music.youtube.com tab, copied from the browser's developer tools
 *  (the steps a person follows are in docs/imports.md, and the same copy is
 *  exported for the dialog as YTMUSIC_HEADERS_STEPS).
 *
 *  That paste is a Google session, so it is handled once and never kept: it
 *  goes to `player.py liked` on stdin (never in argv, where `ps` would show
 *  it), is never written to disk, never logged, and never echoed back in a
 *  response, not even inside an error. Everything that could carry it out of
 *  here goes through `redactSecrets` first.
 *
 *  YouTube Music names the exact video of every liked song, so the items are
 *  created with their candidate already filled in and the runner accepts them
 *  without searching. */

/** How many songs the preview shows, as on the upload route. */
const SAMPLE_SIZE = 5;

const OVER_CAP_MESSAGE = `Ember can transfer up to ${MAX_TRANSFER_ITEMS.toLocaleString('en-GB')} songs at once, and your YouTube Music library has more. Ember will take the newest ${MAX_TRANSFER_ITEMS.toLocaleString('en-GB')}.`;

const FAILED_MESSAGE = 'Ember could not read your YouTube Music likes. Try again in a moment.';

export const POST = withRequestLog('import/liked/ytmusic', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    // Tighter than an upload: this one spends somebody's session on a long
    // read of YouTube Music, and nobody needs to do it twice an hour.
    const limited = rateLimitResponse(`import-secret:${user.id}`, { windowMs: 3_600_000, max: 3 });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { secret?: unknown; preview?: unknown } | null;
    const bad = checkPastedHeaders(body?.secret);
    if (bad) return jsonError(bad.error, 400);
    const secret = normalisePastedHeaders(body?.secret as string);

    const { songs, truncated } = await fetchLikedSongs(secret);
    const parsed = parseYtmusicLiked(songs, { truncated });

    const query = new URL(request.url).searchParams.get('preview');
    if (query === '1' || query === 'true' || body?.preview === true) {
      return Response.json({
        preview: {
          kind: parsed.kind,
          label: parsed.label,
          order: parsed.order,
          count: parsed.items.length,
          dropped: parsed.dropped,
          truncated: parsed.truncated,
          sample: parsed.items.slice(0, SAMPLE_SIZE).map((i) => ({ title: i.title, artist: i.artist })),
        },
      });
    }

    if (!parsed.items.length) {
      return jsonError('There are no liked songs in that YouTube Music account yet.', 422);
    }

    const admin = await createAdminClient();
    const { job } = await createImportJob(admin, {
      userId: user.id,
      source: 'ytmusic',
      sourceId: 'ytmusic-liked',
      sourceUrl: '',
      name: parsed.label,
      coverUrl: null,
      kind: 'liked',
      order: parsed.order,
      items: parsed.items,
    });
    kickImportRunner();
    // `truncated` is news, not a failure: the transfer still runs.
    return Response.json({ job, playlistId: null, truncated: parsed.truncated, note: parsed.truncated ? OVER_CAP_MESSAGE : null }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return failure(e);
  }
});

/** Any failure, as a sentence with nothing of the paste in it. `fromError`
 *  is deliberately not used here: it logs the thrown error whole, and the
 *  one thing this route holds must never be written down. */
function failure(e: unknown): Response {
  const { message, status } = e as { message?: string; status?: number };
  const safe = redactSecrets(message ?? '').trim() || FAILED_MESSAGE;
  const code = typeof status === 'number' && status >= 400 && status <= 599 ? status : 502;
  serverLogger.error('api', 'import/liked/ytmusic failed', { status: code, error: safe });
  return jsonError(safe, code);
}
