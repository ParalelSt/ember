import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { parseImportUrl } from '@/lib/import/url';
import { inspectLink } from '@/lib/import/inspect';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Inspect a pasted playlist link (lib/import/url.ts lists what is accepted)
 *  for the create-playlist dialog's preview. YT Music returns ready Ember
 *  tracks; Spotify returns its source items (the first 100, read from the
 *  public embed page). Nothing is matched here: that is the import job's
 *  work (POST /api/import/jobs). */
export const POST = withRequestLog('import/inspect', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    // Each look-up reads a playlist from Spotify or YouTube: keep it modest.
    const limited = rateLimitResponse(`import:${user.id}`, { windowMs: 600_000, max: 5 });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const parsed = typeof body?.url === 'string' ? parseImportUrl(body.url.slice(0, 500)) : null;
    if (!parsed) {
      return jsonError('Paste a Spotify or YouTube Music playlist link.', 400);
    }
    return Response.json(await inspectLink(user.id, parsed));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
