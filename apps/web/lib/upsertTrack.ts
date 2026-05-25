import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Track } from '@/types/track';

/** Upserts a Track into the shared `tracks` table. Idempotent — every
 *  user-side write (like, history, playlist add) calls this first.
 *  Throws on failure so the calling route fails fast instead of breaking
 *  the FK on the next insert into likes/plays/playlist_tracks. */
export async function upsertTrack(db: SupabaseClient, track: Track) {
  const { error } = await db.from('tracks').upsert({
    id: track.id,
    source: track.source,
    source_id: track.sourceId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration_sec: track.durationSec,
    artwork_url: track.artworkUrl,
    stream_url: track.streamUrl,
  });
  if (error) throw error;
}

export function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

export function fromError(err: unknown) {
  const e = err as { message?: string; status?: number };
  return jsonError(e?.message ?? 'Internal error', e?.status ?? 500);
}
