import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { DEAD_LINK, isInviteCode, PREVIEW_PEOPLE, PREVIEW_SONGS, type InvitePreview } from '@/lib/collab';
import { artworkUrl, collabClient, isMember, membersOf, peopleById, playlistForCode, toPerson } from '@/lib/playlistAccess';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';

/** The invite card: `{ code }`. A POST like the join, so the code never
 *  sits in a URL (or a request log), but read-only: it never adds anyone.
 *  It answers only for a live link (the same 404 as the join for anything
 *  else), only to someone signed in, and shows only what the card does: the playlist's name and cover, people's
 *  names and faces (never an email, never a user id), the song count and
 *  the first few songs. The playlist id goes only to someone already on
 *  it, who is sent straight there. */
export const POST = withRequestLog('playlists/join/preview', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = body?.code;
    if (!isInviteCode(code)) return jsonError(DEAD_LINK, 404);

    const admin = await collabClient();
    const playlist = await playlistForCode(admin, code);
    if (!playlist) return jsonError(DEAD_LINK, 404);
    const ownerId = String(playlist.user);

    const [owners, members, songs] = await Promise.all([
      peopleById(admin, [ownerId]),
      membersOf(admin, playlist.id),
      admin.collection('playlist_tracks').getList(1, PREVIEW_SONGS, {
        filter: admin.filter('playlist = {:p}', { p: playlist.id }),
        sort: 'position,created',
        expand: 'track',
      }),
    ]);
    const alreadyIn = ownerId === user.id || (await isMember(admin, playlist.id, user.id));
    const face = (p: { name: string; avatarUrl: string | null }) => ({ name: p.name, avatarUrl: p.avatarUrl });
    const owner = face(owners.get(ownerId) ?? toPerson({ id: ownerId }));

    const card: InvitePreview = {
      name: String(playlist.name ?? ''),
      artworkUrl: artworkUrl(playlist as { id: string; artwork?: unknown }),
      owner,
      people: [owner, ...members.map(face)].slice(0, PREVIEW_PEOPLE),
      peopleCount: members.length + 1,
      songCount: songs.totalItems,
      songs: songs.items.flatMap((row) => {
        const t = mapTrackRow(((row.expand?.track as unknown) ?? null) as TrackRecord | null);
        return t ? [{ title: t.title, artist: t.artist, artworkUrl: t.artworkUrl }] : [];
      }),
      alreadyIn,
      ...(alreadyIn ? { playlistId: playlist.id } : {}),
    };
    return Response.json(card);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
