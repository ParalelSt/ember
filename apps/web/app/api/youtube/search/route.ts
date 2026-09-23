import type { NextRequest } from 'next/server';
import { searchTracks } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { limitCaller, PUBLIC_PYTHON_LIMITS } from '@/lib/rateLimit';

export const GET = withRequestLog('youtube/search', async (request: NextRequest) => {
  try {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) return Response.json({ tracks: [] });
    // Shares /api/search's budget: both start the same Python search.
    const limited = await limitCaller(request, 'search', PUBLIC_PYTHON_LIMITS.search);
    if (limited) return limited;
    const tracks = await searchTracks(q, { limit: 30 });
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
});
