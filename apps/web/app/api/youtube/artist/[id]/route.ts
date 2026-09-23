import type { NextRequest } from 'next/server';
import { getArtist } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { limitCaller, PUBLIC_PYTHON_LIMITS } from '@/lib/rateLimit';

export const GET = withRequestLog('youtube/artist/[id]', async (request: NextRequest, ctx: RouteContext<'/api/youtube/artist/[id]'>) => {
  try {
    const limited = await limitCaller(request, 'browse', PUBLIC_PYTHON_LIMITS.browse);
    if (limited) return limited;
    const { id } = await ctx.params;
    const data = await getArtist(id);
    return Response.json(data);
  } catch (e) {
    return fromError(e);
  }
});
