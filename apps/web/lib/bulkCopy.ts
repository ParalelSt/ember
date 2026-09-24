import 'server-only';
import { MAX_BULK, toSkip, type CopyOutcome, type CopyPlan, type CopySkip } from '@/lib/playlistCopy';
import type { Track } from '@/types/track';

/** Server helpers for the two bulk copy routes (POST
 *  /api/playlists/[id]/tracks/bulk and POST /api/likes/bulk). */

const SOURCES: Track['source'][] = ['jamendo', 'youtube', 'upload'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** One picked song from the request body, rebuilt field by field so nothing
 *  else the client sent rides along. Null when it is not a song. */
function readTrack(v: unknown): Track | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const id = str(t.id).trim();
  const source = t.source as Track['source'];
  if (!id || id.length > 200 || !SOURCES.includes(source) || !str(t.title)) return null;
  const duration = Number(t.durationSec);
  return {
    id,
    source,
    sourceId: str(t.sourceId) || id.slice(id.indexOf(':') + 1),
    title: str(t.title),
    artist: str(t.artist),
    artistId: strOrNull(t.artistId),
    album: strOrNull(t.album),
    albumId: strOrNull(t.albumId),
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : 0,
    artworkUrl: strOrNull(t.artworkUrl),
    streamUrl: str(t.streamUrl),
  };
}

/** The `tracks` of a bulk request: 1 to MAX_BULK songs, each a real Track. */
export function readBulkTracks(body: unknown): { tracks: Track[] } | { error: string } {
  const raw = (body as { tracks?: unknown } | null)?.tracks;
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'tracks required' };
  if (raw.length > MAX_BULK) return { error: `At most ${MAX_BULK} songs at once` };
  const tracks: Track[] = [];
  for (const item of raw) {
    const track = readTrack(item);
    if (!track) return { error: 'Every song needs an id, a source and a title' };
    tracks.push(track);
  }
  return { tracks };
}

/** Runs `fn` over `items` with at most `limit` running at once (PocketBase
 *  0.22 has no batch endpoint), results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** PocketBase answers a unique-index hit (the song is already there, added
 *  a moment ago by another tab) with a 400. */
export function isUniqueHit(e: unknown): boolean {
  return (e as { status?: number } | undefined)?.status === 400;
}

/** A song the unique index turned away mid-copy: counted as already there. */
export function racedSkip(track: Track): CopySkip {
  return { id: track.id, title: track.title, artist: track.artist, reason: 'same-track', existingTitle: track.title };
}

/** The route's answer: what went in, and every skip in the picked order. */
export function outcomeOf(picked: Track[], plan: CopyPlan, raced: CopySkip[]): CopyOutcome {
  const order = new Map<string, number>();
  picked.forEach((t, i) => {
    if (!order.has(t.id)) order.set(t.id, i);
  });
  return {
    added: plan.add.length - raced.length,
    skipped: [...plan.skipped.map(toSkip), ...raced].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
  };
}
