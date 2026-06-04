import 'server-only';
import type PocketBase from 'pocketbase';
import type { ClientResponseError, RecordModel } from 'pocketbase';
import type { Track } from '@/types/track';
import { serverLogger } from '@/lib/logger/server';

/** Upserts a Track into the shared `tracks` collection by `external_id`.
 *  Returns the PocketBase record id so callers can use it in relations
 *  (likes/plays/playlist_tracks all FK by PB id, not external id).
 *  On hit, additively backfills any fields the row is missing — see
 *  buildBackfillPatch. */
export async function upsertTrack(pb: PocketBase, track: Track): Promise<string> {
  // Try to find an existing row first — cheaper than catching a unique-index
  // conflict on every play.
  try {
    const existing = await pb
      .collection('tracks')
      .getFirstListItem(`external_id = "${escape(track.id)}"`);
    const patch = buildBackfillPatch(existing, track);
    if (Object.keys(patch).length > 0) {
      // Best-effort: a failed backfill must NOT block the caller's primary
      // action (like / play / add-to-playlist).
      await pb.collection('tracks').update(existing.id, patch).catch((e) => {
        serverLogger.error('api', 'upsertTrack backfill failed', { trackId: existing.id }, e);
      });
    }
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

/** Returns only the fields the row is missing AND the incoming Track has.
 *  Never overwrites populated data: avoids title/artist drift between
 *  equivalent variants (e.g. "Blinding Lights" vs "Blinding Lights (Original)").
 *  Patched fields: artwork_url, duration_sec, album, album_id, artist_id. */
function buildBackfillPatch(row: RecordModel, incoming: Track): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (!row.artwork_url && incoming.artworkUrl) p.artwork_url = incoming.artworkUrl;
  if (!row.duration_sec && incoming.durationSec && incoming.durationSec > 0) p.duration_sec = incoming.durationSec;
  if (!row.album && incoming.album) p.album = incoming.album;
  if (!row.album_id && incoming.albumId) p.album_id = incoming.albumId;
  if (!row.artist_id && incoming.artistId) p.artist_id = incoming.artistId;
  return p;
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
  // Server-side log: full error so the cause is visible in the terminal
  // running ./start-static.sh, even when the client-facing message is terse.
  console.error('[API error]', err);
  // Also write to the structured JSONL log so bug reports can include it.
  const e0 = err as { message?: string; status?: number };
  serverLogger.error('api', e0?.message ?? 'API error', { status: e0?.status }, err);

  const e = err as {
    message?: string;
    status?: number;
    data?: { data?: Record<string, { message?: string }> } | Record<string, { message?: string }>;
  };
  // PocketBase nests field-level validation under `.data.data.<field>` (the
  // outer `data` is the response body, the inner `data` is the per-field
  // detail). Some shapes only have one level. Walk both safely.
  const dataObj =
    (e?.data && 'data' in e.data && typeof e.data.data === 'object' ? e.data.data : e?.data) ?? {};
  const fields = Object.entries(dataObj as Record<string, { message?: string }>)
    .map(([f, info]) => (info?.message ? `${f}: ${info.message}` : null))
    .filter(Boolean)
    .join('; ');
  const top = e?.message ?? 'Internal error';
  const message = fields ? `${top} (${fields})` : top;
  return jsonError(message, e?.status ?? 500);
}
