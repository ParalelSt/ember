import type { NextRequest } from 'next/server';
import { getArtist } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/youtube/artist/[id]'>) {
  try {
    const { id } = await ctx.params;
    const data = await getArtist(id);
    return Response.json(data);
  } catch (e) {
    return fromError(e);
  }
}
