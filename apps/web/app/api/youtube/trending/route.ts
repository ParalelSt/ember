import type { NextRequest } from 'next/server';
import { getTrending } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

export async function GET(request: NextRequest) {
  try {
    const country = request.nextUrl.searchParams.get('country') ?? undefined;
    const tracks = await getTrending({ country });
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
}
