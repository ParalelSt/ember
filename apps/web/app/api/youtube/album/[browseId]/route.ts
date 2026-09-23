import type { NextRequest } from 'next/server';
import { getAlbum } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { limitCaller, PUBLIC_PYTHON_LIMITS } from '@/lib/rateLimit';

export const GET = withRequestLog('youtube/album/[browseId]', async (request: NextRequest, ctx: { params: Promise<{ browseId: string }> }) => {
  try {
    const limited = await limitCaller(request, 'browse', PUBLIC_PYTHON_LIMITS.browse);
    if (limited) return limited;
    const { browseId } = await ctx.params;
    const album = await getAlbum(browseId);
    return Response.json(album);
  } catch (e) {
    return fromError(e);
  }
});
