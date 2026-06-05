import type { NextRequest } from 'next/server';
import { getAlbum } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ browseId: string }> }) {
  try {
    const { browseId } = await ctx.params;
    const album = await getAlbum(browseId);
    return Response.json(album);
  } catch (e) {
    return fromError(e);
  }
}
