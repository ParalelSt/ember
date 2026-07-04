import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { loadSession } from '@/lib/sessions';

/** Copy the session queue into a normal playlist owned by the caller —
 *  anyone in the session can keep the roadtrip mix. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/save'>) {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = String(body?.name ?? '').trim() || String(session.name);

    const items = await pb.collection('session_tracks').getFullList({
      filter: `session = "${session.id}"`,
      sort: 'position',
    });
    const playlist = await pb.collection('playlists').create({ user: user.id, name });
    let position = 1;
    for (const item of items) {
      try {
        await pb.collection('playlist_tracks').create({
          playlist: playlist.id,
          track: item.track,
          position: position++,
        });
      } catch {
        // duplicate track in the session (unique index) — skip
      }
    }
    return Response.json({ playlist: { id: playlist.id, name } }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
