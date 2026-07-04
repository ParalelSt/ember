import type { NextRequest } from 'next/server';
import { fetchTrackMeta, VIDEO_ID_RE } from '@/lib/trackMeta';
import { fromError, jsonError } from '@/lib/upsertTrack';

/** Track metadata for the shareable /track/<videoId> page. Public (like the
 *  stream route) so shared links work for logged-out visitors and crawlers;
 *  the two-tier lookup lives in lib/trackMeta (shared with generateMetadata). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ videoId: string }> }) {
  try {
    const { videoId } = await ctx.params;
    if (!VIDEO_ID_RE.test(videoId)) return jsonError('invalid videoId', 400);
    const track = await fetchTrackMeta(videoId);
    if (!track) return jsonError('track not found', 404);
    return Response.json({ track });
  } catch (e) {
    return fromError(e);
  }
}
