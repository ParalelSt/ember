import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { getLyrics } from '@/lib/sources/youtube';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('lyrics', async (req: NextRequest) => {
  try {
    await requireUser();
    const title = req.nextUrl.searchParams.get('title')?.trim() ?? '';
    const artist = req.nextUrl.searchParams.get('artist')?.trim() ?? '';
    if (!title) return jsonError('title is required', 400);
    // The track's length picks the right version's synced lyrics.
    const seconds = Number(req.nextUrl.searchParams.get('durationSec'));
    const durationSec = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;

    const result = await getLyrics(title, artist, durationSec);
    return Response.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
