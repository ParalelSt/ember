import type PocketBase from 'pocketbase';
import { serverLogger } from '@/lib/logger/server';

/** Of these upload ids (the `source_id` of `upload` rows in the shared
 *  `tracks` catalog), the ones whose `uploads` record is gone. Deleting an
 *  upload keeps its catalog row, since it may sit in someone's playlist, so
 *  Admin > Tracks marks those rows "missing" instead of offering a song
 *  whose stream is a 404. One query for the whole page. A failed lookup
 *  marks nothing: the list still shows, only without the marks. */
export async function missingUploadIds(pb: PocketBase, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  try {
    const params = Object.fromEntries(unique.map((id, i) => [`id${i}`, id]));
    const filter = unique.map((_, i) => `id = {:id${i}}`).join(' || ');
    const found = await pb.collection('uploads').getFullList({ filter: pb.filter(filter, params), fields: 'id' });
    const present = new Set(found.map((r) => r.id));
    return new Set(unique.filter((id) => !present.has(id)));
  } catch (e) {
    serverLogger.warn('api', 'missing-upload lookup failed', { count: unique.length }, e);
    return new Set();
  }
}
