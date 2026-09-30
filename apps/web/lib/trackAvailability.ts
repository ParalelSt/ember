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

export interface UnavailableMark {
  reason: UnavailableReason;
  /** When the host last confirmed it (ms since epoch; 0 when unreadable). */
  at: number;
}

let cache: { marks: Map<string, UnavailableMark>; expires: number } | null = null;
const CACHE_TTL_MS = 60_000;

/** How long a flag is trusted without asking YouTube again. Within it the
 *  stream route answers 410 straight from the flag (no yt-dlp run); past it
 *  one play is allowed to try, since a geo block or a private video can come
 *  back. A failed retry writes a fresh date, which starts the window again. */
export const UNAVAILABLE_RECHECK_MS = 3 * 24 * 60 * 60 * 1000;
/** A flag with the same reason is rewritten only once it is this old, so a
 *  repeat does not cost a write on every play but the date still moves on. */
const REMARK_AFTER_MS = 24 * 60 * 60 * 1000;

const REASONS = new Set<string>(['removed', 'private', 'geo', 'members', 'terminated', 'unavailable']);

function toMark(row: { unavailable_at?: string; unavailable_reason?: string }): UnavailableMark {
  const at = Date.parse(String(row.unavailable_at ?? '').replace(' ', 'T'));
  const reason = REASONS.has(row.unavailable_reason ?? '') ? (row.unavailable_reason as UnavailableReason) : 'unavailable';
  return { reason, at: Number.isFinite(at) ? at : 0 };
}

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
    if (row.unavailable_at && row.unavailable_reason === reason && Date.now() - toMark(row).at < REMARK_AFTER_MS) return;
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

async function listMarks(): Promise<Map<string, UnavailableMark>> {
  if (cache && cache.expires > Date.now()) return cache.marks;
  try {
    const pb = await createAdminClient();
    const rows = await pb.collection('tracks').getFullList<{ external_id: string; unavailable_at?: string; unavailable_reason?: string }>({
      filter: 'unavailable_at != ""',
      fields: 'external_id,unavailable_at,unavailable_reason',
    });
    const marks = new Map(rows.map((r) => [r.external_id, toMark(r)] as const));
    cache = { marks, expires: Date.now() + CACHE_TTL_MS };
    return marks;
  } catch (e) {
    serverLogger.error('stream', 'could not list unavailable tracks', {}, e);
    return cache?.marks ?? new Map();
  }
}

export async function listUnavailableIds(): Promise<Set<string>> {
  return new Set((await listMarks()).keys());
}

/** The flag on this track, when there is one recent enough to trust without
 *  asking YouTube again (UNAVAILABLE_RECHECK_MS). Served from the same 60 s
 *  list as listUnavailableIds, so the stream route can ask on every request. */
export async function freshUnavailableMark(externalId: string, now = Date.now()): Promise<UnavailableMark | null> {
  const mark = (await listMarks()).get(externalId);
  if (!mark) return null;
  return now - mark.at < UNAVAILABLE_RECHECK_MS ? mark : null;
}

/** Tests only. */
export function _resetAvailabilityCache(): void {
  cache = null;
}
