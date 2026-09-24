import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import type { CollectionTrack } from '@/types/track';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('playlists/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) => {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;

    const playlistRec = await pb.collection('playlists').getOne(id);

    const items = await pb.collection('playlist_tracks').getFullList({
      filter: `playlist = "${id}"`,
      sort: 'position',
      expand: 'track',
    });

    // addedAt: when the song landed in this playlist, for "Date added".
    const tracks = items.flatMap((i): CollectionTrack[] => {
      const track = mapTrackRow(((i.expand?.track as unknown) ?? null) as TrackRecord | null);
      return track ? [{ ...track, addedAt: String(i.created ?? '') }] : [];
    });

    const artworkFile = typeof playlistRec.artwork === 'string' ? playlistRec.artwork : '';
    return Response.json({
      playlist: {
        id: playlistRec.id,
        name: String(playlistRec.name ?? ''),
        created_at: String(playlistRec.created ?? ''),
        artwork_url: artworkFile ? `/pb/api/files/playlists/${playlistRec.id}/${artworkFile}` : null,
        import_job: typeof playlistRec.import_job === 'string' && playlistRec.import_job ? playlistRec.import_job : null,
      },
      tracks,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const DELETE = withRequestLog('playlists/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) => {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;
    await pb.collection('playlists').delete(id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
