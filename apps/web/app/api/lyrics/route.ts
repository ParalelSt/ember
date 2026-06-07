import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { getLyrics } from '@/lib/sources/youtube';
import { fromError, jsonError } from '@/lib/upsertTrack';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const title = req.nextUrl.searchParams.get('title')?.trim() ?? '';
    const artist = req.nextUrl.searchParams.get('artist')?.trim() ?? '';
    const durationRaw = req.nextUrl.searchParams.get('duration');
    const durationSec = durationRaw && /^\d+(?:\.\d+)?$/.test(durationRaw)
      ? Math.min(7200, Math.max(0, Number(durationRaw)))
      : undefined;
    if (!title) return jsonError('title is required', 400);

    const result = await getLyrics(title, artist, durationSec);
    return Response.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
