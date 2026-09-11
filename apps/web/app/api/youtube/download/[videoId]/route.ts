import type { NextRequest } from 'next/server';
import { ensureDownloaded } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const POST = withRequestLog('youtube/download/[videoId]', async (_req: NextRequest, ctx: RouteContext<'/api/youtube/download/[videoId]'>) => {
  try {
    const { videoId } = await ctx.params;
    const filePath = await ensureDownloaded(videoId);
    return Response.json({ ok: true, filePath });
  } catch (e) {
    return fromError(e);
  }
});
