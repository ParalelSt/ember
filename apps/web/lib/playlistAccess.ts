import 'server-only';
import { randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { fileUrl } from '@/lib/pocketbase/fileUrl';
import { isRecordId, MAX_MEMBERS, publicName } from '@/lib/collab';
import { jsonError } from '@/lib/upsertTrack';
import type { Playlist, PlaylistPerson, PlaylistRole } from '@/types/track';

/** Who may do what with a playlist (pb_hooks/ensure_collab_playlists.pb.js):
 *
 *    owner   everything, as before
 *    member  (only while the playlist is collaborative) read it, add,
 *            remove and reorder songs, leave
 *    anyone else, admins included: nothing, and the same 404 as a playlist
 *            that does not exist, so an id tells nobody anything
 *
 *  PocketBase's own rules still only let the owner in, so a member's reads
 *  and writes go through the server's admin client, and only after this
 *  check. The owner keeps using their own session, where PocketBase checks
 *  everything a second time. */
export interface PlaylistAccess {
  role: PlaylistRole;
  /** The playlist row. */
  playlist: RecordModel;
  /** Reads and writes this playlist's songs: the owner's own session, or
   *  the server's client for a member. */
  db: PocketBase;
  /** The server's client, for names and the member list. Signs in on first
   *  use, so the owner's plain reads never need it. */
  admin: () => Promise<PocketBase>;
}

export const NOT_FOUND = 'That playlist doesn’t exist, or isn’t yours';
export const OWNER_ONLY = 'Only the playlist’s owner can do that';

export const notFound = () => jsonError(NOT_FOUND, 404);
export const ownerOnly = () => jsonError(OWNER_ONLY, 403);

/** The server's client. Its own module-level function so the route tests
 *  can hand in a fake. */
export function collabClient(): Promise<PocketBase> {
  return createCatalogClient();
}

export async function playlistAccess(userPb: PocketBase, userId: string, id: string): Promise<PlaylistAccess | null> {
  if (!isRecordId(id)) return null;
  let server: Promise<PocketBase> | null = null;
  const admin = () => (server ??= collabClient());

  // The owner first, with their own session: PocketBase's rule only lets
  // the owner read it, so this is exactly the check it always was.
  const own = await userPb.collection('playlists').getOne(id).catch((e) => {
    if ((e as { status?: number } | undefined)?.status === 404) return null;
    throw e;
  });
  if (own && own.user === userId) return { role: 'owner', playlist: own, db: userPb, admin };

  const pb = await admin();
  let playlist: RecordModel;
  try {
    playlist = await pb.collection('playlists').getOne(id);
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status === 404) return null;
    throw e;
  }
  if (playlist.user === userId || playlist.collaborative !== true) return null;
  if (!(await isMember(pb, id, userId))) return null;
  return { role: 'member', playlist, db: pb, admin };
}

export async function isMember(admin: PocketBase, playlistId: string, userId: string): Promise<boolean> {
  try {
    await admin
      .collection('playlist_members')
      .getFirstListItem(admin.filter('playlist = {:p} && user = {:u}', { p: playlistId, u: userId }));
    return true;
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status === 404) return false;
    throw e;
  }
}

/** Put someone on a playlist's member list. `already` when they were on
 *  it, `full` at MAX_MEMBERS. The (playlist, user) unique index makes a
 *  double join (two tabs) land once. */
export async function addMember(
  admin: PocketBase,
  playlistId: string,
  userId: string,
): Promise<'added' | 'already' | 'full'> {
  if (await isMember(admin, playlistId, userId)) return 'already';
  const { totalItems } = await admin
    .collection('playlist_members')
    .getList(1, 1, { filter: admin.filter('playlist = {:p}', { p: playlistId }), fields: 'id' });
  if (totalItems >= MAX_MEMBERS) return 'full';
  try {
    await admin.collection('playlist_members').create({ playlist: playlistId, user: userId });
    return 'added';
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status === 400) {
      if (await isMember(admin, playlistId, userId)) return 'already';
      // The before-create hook (ensure_collab_playlists) refuses the 51st
      // member inside the write itself, so several joins at once cannot all
      // pass the count above. Its refusal arrives as a plain 400.
      const now = await admin
        .collection('playlist_members')
        .getList(1, 1, { filter: admin.filter('playlist = {:p}', { p: playlistId }), fields: 'id' });
      if (now.totalItems >= MAX_MEMBERS) return 'full';
    }
    throw e;
  }
}

export function artworkUrl(record: { id: string; artwork?: unknown }): string | null {
  const file = typeof record.artwork === 'string' ? record.artwork : '';
  return file ? `/pb/api/files/playlists/${record.id}/${file}` : null;
}

/** How many song covers a playlist tile's mosaic needs. */
export const MOSAIC_ARTWORKS = 4;

/** The first MOSAIC_ARTWORKS distinct song covers of each playlist, in
 *  playlist order, from playlist_tracks rows already sorted by position
 *  (each with its track expanded, or only `expand.track.artwork_url`). Rows
 *  without art are skipped. Pure, so the list route stays one query. */
export function firstArtworks(rows: readonly RecordModel[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const pid = String(r.playlist ?? '');
    const art = (r.expand?.track as { artwork_url?: unknown } | undefined)?.artwork_url;
    if (!pid || typeof art !== 'string' || !art) continue;
    const list = out.get(pid) ?? [];
    if (list.length < MOSAIC_ARTWORKS && !list.includes(art)) list.push(art);
    out.set(pid, list);
  }
  return out;
}

/** The covers for the Home tiles' mosaics, for every playlist in the
 *  library in at most two requests: one for your own (your session, so
 *  PocketBase checks it too), one for the shared ones (the server's
 *  client, like their rows). Only the playlist id and the song's cover
 *  come back, never the whole song. */
export async function playlistArtworks(
  pb: PocketBase,
  userId: string,
  shared: readonly Playlist[],
  admin: () => Promise<PocketBase>,
): Promise<Map<string, string[]>> {
  const query = { sort: 'position,created', expand: 'track', fields: 'playlist,expand.track.artwork_url' };
  const own = await pb.collection('playlist_tracks').getFullList({
    ...query,
    filter: pb.filter('playlist.user = {:u} && track.artwork_url != ""', { u: userId }),
  });
  let theirs: RecordModel[] = [];
  const ids = shared.map((p) => p.id).filter(isRecordId);
  if (ids.length > 0) {
    const server = await admin();
    const params: Record<string, string> = {};
    const clauses = ids.map((id, i) => {
      params[`p${i}`] = id;
      return `playlist = {:p${i}}`;
    });
    theirs = await server.collection('playlist_tracks').getFullList({ ...query, filter: server.filter(clauses.join(' || '), params) });
  }
  return firstArtworks([...own, ...theirs]);
}

/** A user row as members see it: name and picture, no email. */
export function toPerson(user: RecordModel | Record<string, unknown>): PlaylistPerson {
  const u = user as Record<string, unknown> & { id: string };
  const avatar = typeof u.avatar === 'string' ? u.avatar : '';
  return { id: String(u.id), name: publicName(u), avatarUrl: avatar ? fileUrl(u, avatar) : null };
}

/** The people behind a set of user ids, in one request. Unknown ids (a
 *  deleted account) are simply missing from the map. */
export async function peopleById(admin: PocketBase, ids: string[]): Promise<Map<string, PlaylistPerson>> {
  const unique = [...new Set(ids.filter(isRecordId))];
  const out = new Map<string, PlaylistPerson>();
  if (unique.length === 0) return out;
  const params: Record<string, string> = {};
  const clauses = unique.map((id, i) => {
    params[`u${i}`] = id;
    return `id = {:u${i}}`;
  });
  const rows = await admin.collection('users').getFullList({ filter: admin.filter(clauses.join(' || '), params) });
  for (const r of rows) out.set(r.id, toPerson(r));
  return out;
}

/** Everyone on a playlist's member list, oldest first. */
export async function membersOf(admin: PocketBase, playlistId: string): Promise<PlaylistPerson[]> {
  const rows = await admin.collection('playlist_members').getFullList({
    filter: admin.filter('playlist = {:p}', { p: playlistId }),
    sort: 'created',
    expand: 'user',
  });
  return rows.flatMap((r) => {
    const user = r.expand?.user as RecordModel | undefined;
    return user ? [toPerson(user)] : [];
  });
}

/** The playlists other people shared with this user, newest share first.
 *  Only collaborative ones: turning collaboration off hides it again. */
export async function sharedWith(admin: PocketBase, userId: string): Promise<Playlist[]> {
  const rows = await admin.collection('playlist_members').getFullList({
    filter: admin.filter('user = {:u}', { u: userId }),
    sort: '-created',
    expand: 'playlist,playlist.user',
  });
  return rows.flatMap((r): Playlist[] => {
    const p = r.expand?.playlist as RecordModel | undefined;
    if (!p || p.collaborative !== true || p.user === userId) return [];
    const owner = p.expand?.user as RecordModel | undefined;
    return [{
      id: p.id,
      name: String(p.name ?? ''),
      created_at: String(p.created ?? ''),
      artwork_url: artworkUrl(p as { id: string; artwork?: unknown }),
      collaborative: true,
      role: 'member',
      owner_name: owner ? publicName(owner) : publicName(null),
      owner_avatar_url: owner ? toPerson(owner).avatarUrl : null,
    }];
  });
}

/** The one collaborative playlist whose live link this is, or null. The
 *  code must already have passed isInviteCode. */
export async function playlistForCode(admin: PocketBase, code: string, fields?: string) {
  const found = await admin.collection('playlists').getList(1, 2, {
    filter: admin.filter('invite_code = {:code} && collaborative = true', { code }),
    ...(fields ? { fields } : {}),
  });
  return found.items.length === 1 ? found.items[0] : null;
}

/** A fresh invite code: 24 random bytes, base64url (32 characters, the
 *  shape lib/collab's isInviteCode accepts). */
export function newInviteCode(): string {
  return randomBytes(24).toString('base64url');
}
