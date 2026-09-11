import type { NextRequest } from 'next/server';
import { getArtist } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('youtube/artist/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/youtube/artist/[id]'>) => {
  try {
    const { id } = await ctx.params;
    const data = await getArtist(id);
    return Response.json(data);
  } catch (e) {
    return fromError(e);
  }
});
