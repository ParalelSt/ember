import type { NextRequest } from 'next/server';
import { getRecommended } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

export async function GET(request: NextRequest) {
  try {
    const seed = request.nextUrl.searchParams.get('seed') ?? undefined;
    const country = request.nextUrl.searchParams.get('country') ?? undefined;
    const tracks = await getRecommended({ seed, country });
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
}
