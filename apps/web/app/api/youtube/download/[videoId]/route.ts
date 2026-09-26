import type { NextRequest } from 'next/server';
import { ensureDownloaded, findCachedFile, isDownloading, isTooLargeError } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { newFetchLimitResponse, signedInMember, signInToFetchResponse } from '@/lib/downloadAccess';
import { tooLargeResponse } from '@/lib/mediaLimits';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Downloads a song to the host. Members only, on the same per-member budget
 *  as the stream route (lib/downloadAccess, security audit 2026-09-25, M2),
 *  checked here too rather than trusting the proxy's sign-in gate alone. */
export const POST = withRequestLog('youtube/download/[videoId]', async (_req: NextRequest, ctx: RouteContext<'/api/youtube/download/[videoId]'>) => {
  try {
    const member = await signedInMember();
    if (!member) return signInToFetchResponse();
    const { videoId } = await ctx.params;
    if (!VIDEO_ID_RE.test(videoId)) return Response.json({ error: 'invalid videoId' }, { status: 400 });
    if (!isDownloading(videoId) && !findCachedFile(videoId)) {
      const limited = newFetchLimitResponse(member);
      if (limited) return limited;
    }
    const filePath = await ensureDownloaded(videoId);
    return Response.json({ ok: true, filePath });
  } catch (e) {
    if (isTooLargeError(e)) return tooLargeResponse(e.message);
    return fromError(e);
  }
});
