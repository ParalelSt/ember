import type { NextRequest } from 'next/server';
import { getTrack } from '@/lib/sources/jamendo';
import { fromError, jsonError } from '@/lib/upsertTrack';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/tracks/[id]'>) {
  try {
    const { id } = await ctx.params;
    const [source, sourceId] = id.includes(':') ? id.split(':') : ['jamendo', id];
    if (source !== 'jamendo') return jsonError('Unknown source', 404);
    const track = await getTrack(sourceId);
    if (!track) return jsonError('Not found', 404);
    return Response.json({ track });
  } catch (e) {
    return fromError(e);
  }
}
