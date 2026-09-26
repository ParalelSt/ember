import path from 'node:path';
import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { findCachedFile } from '@/lib/sources/youtube';
import { hasUploadArt, MIME_BY_EXT } from '@/lib/uploads';
import { publicOrigin } from '@/lib/publicOrigin';
import { rateLimitResponse } from '@/lib/rateLimit';
import { isSignableTrackId, signStreamToken, STREAM_TOKEN_PARAM } from '@/lib/streamToken';
import { jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import type { CastItem, CastSignResponse } from '@/lib/cast/types';

/** Most tracks one call signs: a long queue, with room to spare. */
const MAX_SIGN_IDS = 500;
/** Calls per member per minute. A cast queue signs once, then a song or a
 *  radio batch at a time. */
const SIGN_LIMIT = { windowMs: 60_000, max: 60 };

/** Signed links a cast device can play without a cookie (lib/streamToken).
 *
 *  POST { ids: string[] } -> { origin, expiresAt, items: { [id]: CastItem } }
 *
 *  Members only. Each link plays one track, for six hours, and counts
 *  against the member who asked for it. Ids that are not a YouTube video or
 *  an upload are left out of `items`. */
export const POST = withRequestLog('cast/sign', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`cast-sign:${user.id}`, SIGN_LIMIT);
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
    if (!body || !Array.isArray(body.ids)) return jsonError('ids required', 400);
    if (body.ids.length > MAX_SIGN_IDS) return jsonError(`at most ${MAX_SIGN_IDS} ids`, 400);
    const ids = [...new Set(body.ids.filter(isSignableTrackId))];

    const origin = publicOrigin(request);
    const uploads = await uploadInfo(ids.filter((id) => id.startsWith('upload:')).map((id) => id.slice(7)));

    let expiresAt = 0;
    const sign = (trackId: string, scope: 'stream' | 'art') => {
      const t = signStreamToken({ trackId, userId: user.id, scope });
      expiresAt = t.expiresAt;
      return `${STREAM_TOKEN_PARAM}=${encodeURIComponent(t.token)}`;
    };

    const items: Record<string, CastItem> = {};
    for (const id of ids) {
      if (id.startsWith('youtube:')) {
        const videoId = id.slice(8);
        const cached = findCachedFile(videoId);
        items[id] = {
          streamUrl: `${origin}/api/youtube/stream/${videoId}?${sign(id, 'stream')}`,
          artworkUrl: null,
          // Not on disk yet: yt-dlp prefers m4a (player.py).
          contentType: (cached && MIME_BY_EXT[path.extname(cached).toLowerCase()]) || 'audio/mp4',
        };
      } else {
        const recordId = id.slice(7);
        const info = uploads.get(recordId);
        items[id] = {
          streamUrl: `${origin}/api/uploads/${recordId}/stream?${sign(id, 'stream')}`,
          artworkUrl: info?.hasArt ? `${origin}/api/uploads/${recordId}/art?${sign(id, 'art')}` : null,
          contentType: info?.contentType ?? 'audio/mpeg',
        };
      }
    }
    return Response.json({ origin, expiresAt, items } satisfies CastSignResponse);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    serverLogger.error('cast', 'signing cast links failed', undefined, e);
    return jsonError('could not sign cast links', 500);
  }
});

/** Content type and cover presence for the uploads among the ids. A lookup
 *  that fails costs only accuracy: the link still plays. */
async function uploadInfo(recordIds: string[]): Promise<Map<string, { contentType: string; hasArt: boolean }>> {
  const out = new Map<string, { contentType: string; hasArt: boolean }>();
  if (recordIds.length === 0) return out;
  try {
    const pb = await createAdminClient();
    // Ids passed isSignableTrackId (letters and digits only): safe to inline.
    const filter = recordIds.map((id) => `id="${id}"`).join(' || ');
    const rows = await pb.collection('uploads').getFullList({ filter });
    for (const row of rows) {
      const ext = path.extname(String(row.filename ?? '')).toLowerCase();
      out.set(row.id, { contentType: MIME_BY_EXT[ext] ?? 'audio/mpeg', hasArt: hasUploadArt(row) });
    }
  } catch (e) {
    serverLogger.error('cast', 'upload lookup for cast links failed', { count: recordIds.length }, e);
  }
  return out;
}
