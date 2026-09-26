import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { artworkUrl, collabClient, sharedWith } from '@/lib/playlistAccess';
import type { Playlist } from '@/types/track';

const MAX_NAME_LEN = 200;

/** Your own playlists, newest first, then the collaborative ones other
 *  people added you to (newest share first, `role: 'member'`, with the
 *  owner's name). */
export const GET = withRequestLog('playlists', async () => {
  try {
    const { pb, user } = await requireUser();
    const records = await pb.collection('playlists').getFullList({
      filter: `user = "${user.id}"`,
      sort: '-created',
    });
    const own: Playlist[] = records.map((r) => ({
      id: r.id,
      name: String(r.name ?? ''),
      created_at: String(r.created ?? ''),
      artwork_url: artworkUrl(r as { id: string; artwork?: unknown }),
      collaborative: r.collaborative === true,
      role: 'owner',
    }));
    // A server that cannot sign in as its admin still lists your own.
    let shared: Playlist[] = [];
    try {
      shared = await sharedWith(await collabClient(), user.id);
    } catch (e) {
      serverLogger.error('api', 'shared playlists lookup failed', { userId: user.id }, e instanceof Error ? e : undefined);
    }
    return Response.json({ playlists: [...own, ...shared] });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const POST = withRequestLog('playlists', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = String(body?.name ?? '').trim();
    if (!name) return jsonError('name required', 400);
    if (name.length > MAX_NAME_LEN) {
      return jsonError(`name must be at most ${MAX_NAME_LEN} characters`, 400);
    }
    const r = await pb.collection('playlists').create({ user: user.id, name });
    return Response.json({
      playlist: {
        id: r.id,
        name: String(r.name ?? ''),
        created_at: String(r.created ?? ''),
        artwork_url: artworkUrl(r as { id: string; artwork?: unknown }),
        collaborative: false,
        role: 'owner',
      },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
