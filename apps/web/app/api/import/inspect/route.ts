import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { getYtPlaylist } from '@/lib/sources/youtube';
import { getSpotifyPlaylist, resolveSpotifyShortLink } from '@/lib/sources/spotify';
import { parseImportUrl } from '@/lib/import/url';
import type { InspectResult } from '@/lib/import/types';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Inspect a pasted playlist link (lib/import/url.ts lists what is accepted).
 *  YT Music returns ready-to-add Ember tracks; Spotify returns its source
 *  items (the first 100, read from the public embed page) for the
 *  client-driven match loop. */
export const POST = withRequestLog('import/inspect', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    // Throttle STARTING imports (each can spawn many match processes). A
    // running import's match batches aren't gated here, so it always finishes.
    const limited = rateLimitResponse(`import:${user.id}`, { windowMs: 600_000, max: 5 });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const parsed = typeof body?.url === 'string' ? parseImportUrl(body.url.slice(0, 500)) : null;
    if (!parsed) {
      return jsonError('Paste a Spotify or YouTube Music playlist link.', 400);
    }
    if (parsed.source === 'ytmusic') {
      const { name, tracks } = await getYtPlaylist(parsed.id);
      return Response.json({ source: 'ytmusic', name, tracks } satisfies InspectResult);
    }
    const id = parsed.source === 'spotify' ? parsed.id : await resolveSpotifyShortLink(parsed.url);
    const pl = await getSpotifyPlaylist(id);
    return Response.json({
      source: 'spotify',
      id: pl.id,
      name: pl.name,
      coverUrl: pl.coverUrl,
      items: pl.items,
      truncated: pl.truncated,
    } satisfies InspectResult);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
