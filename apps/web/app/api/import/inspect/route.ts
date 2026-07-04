import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { getYtPlaylist } from '@/lib/sources/youtube';
import { getSpotifyPlaylist } from '@/lib/sources/spotify';

/** Parse a pasted link into an import source + playlist id.
 *  Supported: open.spotify.com/playlist/<id>, spotify:playlist:<id>,
 *  music.youtube.com/playlist?list=<id>, youtube.com/playlist?list=<id>. */
function parseImportUrl(raw: string): { source: 'spotify' | 'ytmusic'; id: string } | null {
  const s = raw.trim();
  const uri = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(s);
  if (uri) return { source: 'spotify', id: uri[1] };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.hostname.endsWith('spotify.com')) {
    const m = /\/playlist\/([A-Za-z0-9]+)/.exec(url.pathname);
    return m ? { source: 'spotify', id: m[1] } : null;
  }
  if (url.hostname.endsWith('youtube.com') || url.hostname.endsWith('youtu.be')) {
    const list = url.searchParams.get('list');
    return list ? { source: 'ytmusic', id: list } : null;
  }
  return null;
}

/** Inspect a pasted playlist link. YT Music returns ready-to-add Ember tracks;
 *  Spotify returns raw {title, artist} items for the client-driven match loop. */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();
    // Throttle STARTING imports (each can spawn many match processes). A
    // running import's match batches aren't gated here, so it always finishes.
    const limited = rateLimitResponse(`import:${user.id}`, { windowMs: 600_000, max: 5 });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { url?: string } | null;
    const parsed = body?.url ? parseImportUrl(body.url) : null;
    if (!parsed) {
      return jsonError('Paste a Spotify or YouTube Music playlist link.', 400);
    }
    if (parsed.source === 'ytmusic') {
      const { name, tracks } = await getYtPlaylist(parsed.id);
      return Response.json({ source: 'ytmusic', name, tracks });
    }
    const { name, items } = await getSpotifyPlaylist(parsed.id);
    return Response.json({ source: 'spotify', name, items });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
