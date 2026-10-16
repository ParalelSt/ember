import 'server-only';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import type { AuthedUser } from '@/lib/auth';
import { jsonError } from '@/lib/upsertTrack';
import { serverLogger } from '@/lib/logger/server';
import { uploadArtUrl } from '@/lib/uploads';

/** The upload a member may change (edit details, set or remove its cover):
 *  their own, or any one for an admin. The same rule the delete route keeps.
 *  `pb` is the admin client: the collection's update rule is null, so only
 *  the server writes it, and this check is what stands in for that rule. */
export async function loadOwnUpload(
  pb: PocketBase,
  id: string,
  user: AuthedUser,
): Promise<{ row: RecordModel; error?: never } | { row?: never; error: Response }> {
  const row = await pb.collection('uploads').getOne(id).catch(() => null);
  if (!row) return { error: jsonError('Upload not found', 404) };
  if (row.uploader !== user.id && !user.isAdmin) {
    return { error: jsonError('Only the person who uploaded this can change it', 403) };
  }
  return { row };
}

/** Copies an upload's details onto its row in the shared `tracks` catalog,
 *  if it has one (it gets one once someone likes it, plays it or adds it to
 *  a playlist). Those rows keep their own title, artist, album and artwork,
 *  so without this an edited song would keep its old name in every
 *  playlist. Best effort: the upload itself is already saved. */
export async function syncCatalogUpload(pb: PocketBase, row: RecordModel): Promise<void> {
  try {
    const hits = await pb.collection('tracks').getFullList({
      filter: pb.filter('external_id = {:id}', { id: `upload:${row.id}` }),
    });
    for (const hit of hits) {
      await pb.collection('tracks').update(hit.id, {
        title: String(row.title ?? ''),
        artist: String(row.artist ?? ''),
        album: String(row.album ?? ''),
        artwork_url: uploadArtUrl(row) ?? '',
      });
    }
  } catch (e) {
    serverLogger.warn('api', 'upload catalog sync failed', { id: row.id }, e);
  }
}
