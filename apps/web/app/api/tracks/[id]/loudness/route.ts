import type { NextRequest } from 'next/server';
import { measureLoudness, readTrackGain } from '@/lib/sources/youtube';
import { withRequestLog } from '@/lib/logger/withRequestLog';

const YOUTUBE_ID_RE = /^youtube:([A-Za-z0-9_-]{11})$/;

/** The volume normalization gain for one track, in dB (loudness.py).
 *
 *  `{ gainDb: null }` means "not measured yet": the player plays the song
 *  unchanged. A song that is already on disk but was never measured (it was
 *  downloaded before this existed) gets measured in the background right
 *  now, so asking again a little later, or on its next play, finds a value.
 *  Only YouTube tracks have one; anything else is always null. */
export const GET = withRequestLog('tracks/[id]/loudness', async (_req: NextRequest, ctx: RouteContext<'/api/tracks/[id]/loudness'>) => {
  const { id } = await ctx.params;
  const videoId = YOUTUBE_ID_RE.exec(id)?.[1];
  const gainDb = videoId ? readTrackGain(videoId) : null;
  if (gainDb !== null) {
    // A video's audio never changes, so neither does its gain.
    return Response.json({ gainDb }, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  }
  if (videoId) void measureLoudness(videoId);
  return Response.json({ gainDb: null }, { headers: { 'Cache-Control': 'no-store' } });
});
