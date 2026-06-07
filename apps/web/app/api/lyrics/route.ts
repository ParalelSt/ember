import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { getLyrics } from '@/lib/sources/youtube';
import { fromError, jsonError } from '@/lib/upsertTrack';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const title = req.nextUrl.searchParams.get('title')?.trim() ?? '';
    const artist = req.nextUrl.searchParams.get('artist')?.trim() ?? '';
    if (!title) return jsonError('title is required', 400);

    const result = await getLyrics(title, artist);
    return Response.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
