import type { NextRequest } from 'next/server';
import { searchTracks } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) return Response.json({ tracks: [] });
    const tracks = await searchTracks(q, { limit: 30 });
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
}
