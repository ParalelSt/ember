import type { NextRequest } from 'next/server';
import { fetchTrackMeta, VIDEO_ID_RE } from '@/lib/trackMeta';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { limitCaller, PUBLIC_PYTHON_LIMITS } from '@/lib/rateLimit';

/** Track metadata for the shareable /track/<videoId> page. Public (like the
 *  stream route) so shared links work for logged-out visitors and crawlers;
 *  the two-tier lookup lives in lib/trackMeta (shared with generateMetadata). */
export const GET = withRequestLog('youtube/track/[videoId]', async (request: NextRequest, ctx: { params: Promise<{ videoId: string }> }) => {
  try {
    const { videoId } = await ctx.params;
    if (!VIDEO_ID_RE.test(videoId)) return jsonError('invalid videoId', 400);
    const limited = await limitCaller(request, 'browse', PUBLIC_PYTHON_LIMITS.browse);
    if (limited) return limited;
    const track = await fetchTrackMeta(videoId);
    if (!track) return jsonError('track not found', 404);
    return Response.json({ track });
  } catch (e) {
    return fromError(e);
  }
});
