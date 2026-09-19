import 'server-only';
import { getYtPlaylist } from '@/lib/sources/youtube';
import { getSpotifyPlaylist, resolveSpotifyShortLink } from '@/lib/sources/spotify';
import type { ImportLink } from '@/lib/import/url';
import type { InspectResult } from '@/lib/import/types';

// Reading a pasted link, shared by the preview (POST /api/import/inspect)
// and the job start (POST /api/import/jobs). The preview's answer is kept
// for a few minutes per user, so pressing Create right after the preview
// does not read the playlist a second time.

const TTL_MS = 10 * 60_000;
const MAX = 100;
const cache = new Map<string, { at: number; value: InspectResult }>();

function key(userId: string, link: ImportLink): string {
  return `${userId}:${link.source}:${link.source === 'spotify-short' ? link.url : link.id}`;
}

export async function inspectLink(userId: string, link: ImportLink): Promise<InspectResult> {
  const k = key(userId, link);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: InspectResult;
  if (link.source === 'ytmusic') {
    const { name, tracks } = await getYtPlaylist(link.id);
    value = { source: 'ytmusic', id: link.id, name, tracks };
  } else {
    const id = link.source === 'spotify' ? link.id : await resolveSpotifyShortLink(link.url);
    const pl = await getSpotifyPlaylist(id);
    value = {
      source: 'spotify',
      id: pl.id,
      name: pl.name,
      coverUrl: pl.coverUrl,
      items: pl.items,
      truncated: pl.truncated,
    };
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
  cache.set(k, { at: Date.now(), value });
  return value;
}
