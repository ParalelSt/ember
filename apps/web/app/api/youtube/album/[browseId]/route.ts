import type { NextRequest } from 'next/server';
import { getAlbum } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('youtube/album/[browseId]', async (_req: NextRequest, ctx: { params: Promise<{ browseId: string }> }) => {
  try {
    const { browseId } = await ctx.params;
    const album = await getAlbum(browseId);
    return Response.json(album);
  } catch (e) {
    return fromError(e);
  }
});
