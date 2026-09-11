import 'server-only';
import { createAdminClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import type { UnavailableReason } from '@/lib/sources/youtube';

interface AvailabilityRow {
  id: string;
  unavailable_at?: string;
  unavailable_reason?: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
let cache: { ids: Set<string>; expires: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function findRow(externalId: string) {
  const pb = await createAdminClient();
  const row = await pb.collection('tracks').getFirstListItem<AvailabilityRow>(`external_id = "${esc(externalId)}"`);
  return { pb, row };
}

/** Best effort on purpose: no admin login, or a track nobody has saved yet,
 *  must not turn a clean 410 into a 500. The stream answer is the priority. */
export async function markTrackUnavailable(externalId: string, reason: UnavailableReason): Promise<void> {
  try {
    const { pb, row } = await findRow(externalId);
    // Only skip the write when the flag AND reason already match: a changed
    // reason (geo today, removed tomorrow) still needs to land, but a repeat
    // of the same reason should not cost a write on every play.
    if (row.unavailable_at && row.unavailable_reason === reason) return;
    await pb.collection('tracks').update(row.id, { unavailable_at: new Date().toISOString(), unavailable_reason: reason });
    cache = null;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) serverLogger.error('stream', 'could not mark track unavailable', { externalId }, e);
  }
}

/** Mirrors markTrackUnavailable: best effort, never throws into the caller. */
export async function clearTrackUnavailable(externalId: string): Promise<void> {
  try {
    const { pb, row } = await findRow(externalId);
    if (!row.unavailable_at) return;
    await pb.collection('tracks').update(row.id, { unavailable_at: '', unavailable_reason: '' });
    cache = null;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) serverLogger.error('stream', 'could not clear track unavailable', { externalId }, e);
  }
}

export async function listUnavailableIds(): Promise<Set<string>> {
  if (cache && cache.expires > Date.now()) return cache.ids;
  try {
    const pb = await createAdminClient();
    const rows = await pb.collection('tracks').getFullList<{ external_id: string }>({
      filter: 'unavailable_at != ""',
      fields: 'external_id',
    });
    const ids = new Set(rows.map((r) => r.external_id));
    cache = { ids, expires: Date.now() + CACHE_TTL_MS };
    return ids;
  } catch (e) {
    serverLogger.error('stream', 'could not list unavailable tracks', {}, e);
    return cache?.ids ?? new Set();
  }
}
