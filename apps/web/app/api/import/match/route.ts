import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { matchTracks } from '@/lib/sources/youtube';

const MAX_BATCH = 8;

interface MatchItem {
  title?: string;
  artist?: string;
}

/** Match a small batch of Spotify tracks onto YT Music. The import dialog
 *  loops these so a 300-track playlist never hits one long request. */
export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = (await request.json().catch(() => null)) as { items?: MatchItem[] } | null;
    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items?.length) return jsonError('items required', 400);
    if (items.length > MAX_BATCH) return jsonError(`max ${MAX_BATCH} items per call`, 400);
    const cleaned = items.map((i) => ({
      title: String(i.title ?? '').slice(0, 200),
      artist: String(i.artist ?? '').slice(0, 200),
    }));
    const tracks = await matchTracks(cleaned);
    return Response.json({ tracks });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
