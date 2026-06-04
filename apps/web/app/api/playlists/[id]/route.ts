import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fromError } from '@/lib/upsertTrack';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;

    const playlistRec = await pb.collection('playlists').getOne(id);

    const items = await pb.collection('playlist_tracks').getFullList({
      filter: `playlist = "${id}"`,
      sort: 'position',
      expand: 'track',
    });

    const tracks = items
      .map((i) => mapTrackRow(((i.expand?.track as unknown) ?? null) as TrackRecord | null))
      .filter(Boolean);

    const artworkFile = typeof playlistRec.artwork === 'string' ? playlistRec.artwork : '';
    return Response.json({
      playlist: {
        id: playlistRec.id,
        name: String(playlistRec.name ?? ''),
        created_at: String(playlistRec.created ?? ''),
        artwork_url: artworkFile ? `/pb/api/files/playlists/${playlistRec.id}/${artworkFile}` : null,
      },
      tracks,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;
    await pb.collection('playlists').delete(id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
