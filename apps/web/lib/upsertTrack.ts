import 'server-only';
import type PocketBase from 'pocketbase';
import type { ClientResponseError } from 'pocketbase';
import type { Track } from '@/types/track';

/** Upserts a Track into the shared `tracks` collection by `external_id`.
 *  Returns the PocketBase record id so callers can use it in relations
 *  (likes/plays/playlist_tracks all FK by PB id, not external id). */
export async function upsertTrack(pb: PocketBase, track: Track): Promise<string> {
  // Try to find an existing row first — cheaper than catching a unique-index
  // conflict on every play.
  try {
    const existing = await pb
      .collection('tracks')
      .getFirstListItem(`external_id = "${escape(track.id)}"`);
    return existing.id;
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }

  // Not found — create. If a concurrent request wins the unique-index race,
  // PocketBase rejects with 400; in that case look it up again.
  try {
    const created = await pb.collection('tracks').create({
      external_id: track.id,
      source: track.source,
      source_id: track.sourceId,
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
      duration_sec: track.durationSec ?? 0,
      artwork_url: track.artworkUrl ?? '',
      stream_url: track.streamUrl ?? '',
    });
    return created.id;
  } catch (e) {
    if (isUniqueConflict(e)) {
      const existing = await pb
        .collection('tracks')
        .getFirstListItem(`external_id = "${escape(track.id)}"`);
      return existing.id;
    }
    throw e;
  }
}

function isNotFound(e: unknown): boolean {
  return (e as ClientResponseError | undefined)?.status === 404;
}

function isUniqueConflict(e: unknown): boolean {
  // PocketBase returns 400 with a `data.external_id` validation error when the
  // unique index trips. Treat any 400 from this insert as conflict — we already
  // know the only constrained field is external_id.
  return (e as ClientResponseError | undefined)?.status === 400;
}

// PB filter strings interpolate raw — escape user-controlled text.
function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

export function fromError(err: unknown) {
  const e = err as { message?: string; status?: number };
  return jsonError(e?.message ?? 'Internal error', e?.status ?? 500);
}
