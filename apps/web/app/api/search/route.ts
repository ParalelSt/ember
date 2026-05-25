import type { NextRequest } from 'next/server';
import { featured } from '@/lib/sources/jamendo';
import { searchTracks as youtubeSearch } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) {
      try {
        const tracks = await featured({ limit: 30 });
        return Response.json({ tracks });
      } catch {
        return Response.json({ tracks: [] });
      }
    }
    const tracks = await youtubeSearch(q, { limit: 30 });
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
}
