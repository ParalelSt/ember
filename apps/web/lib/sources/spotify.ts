import 'server-only';
import { serverLogger } from '@/lib/logger/server';
import { EmbedError, parseEmbedPage, type SourceItem } from '@/lib/import/embed';
import { parseImportUrl } from '@/lib/import/url';

/** Read a public Spotify playlist for import, with no keys and no setup.
 *
 *  Spotify's February 2026 Web API change made the old client-credentials
 *  read useless (tracks come back only for playlists the app's owner owns),
 *  so this reads the public embed page instead (lib/import/embed.ts), plus
 *  the official oEmbed endpoint for the preview's name and cover. The embed
 *  page lists the first 100 tracks. Both live on open.spotify.com;
 *  `SPOTIFY_EMBED_BASE` points them at tests/fake-spotify.mjs in tests. */

const BASE = (process.env.SPOTIFY_EMBED_BASE || 'https://open.spotify.com').replace(/\/+$/, '');
const TIMEOUT_MS = 15_000;
// The embed page is built for browsers; a browser user agent gets the same
// page a browser does.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

interface StatusError extends Error {
  status?: number;
}

function err(message: string, status: number): StatusError {
  const e: StatusError = new Error(message);
  e.status = status;
  return e;
}

export const SPOTIFY_NOT_FOUND =
  "Spotify couldn't find that playlist. Check the link, and make sure the playlist is public: private playlists can't be imported.";
export const SPOTIFY_UNREADABLE =
  "Spotify changed its playlist page and Ember can't read the songs right now. Try again later, or send a bug report.";
export const SPOTIFY_UNREACHABLE = "Couldn't reach Spotify. Try again in a moment.";
export const SPOTIFY_EMPTY = 'That playlist has no songs Ember can import.';

async function get(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Name and cover from oEmbed. Best effort: null when it fails. */
async function getOEmbed(id: string): Promise<{ title: string | null; thumbnail: string | null } | null> {
  try {
    const target = encodeURIComponent(`https://open.spotify.com/playlist/${id}`);
    const res = await get(`${BASE}/oembed?url=${target}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: unknown; thumbnail_url?: unknown };
    return {
      title: typeof json.title === 'string' && json.title.trim() ? json.title.trim() : null,
      thumbnail: typeof json.thumbnail_url === 'string' ? json.thumbnail_url : null,
    };
  } catch {
    return null;
  }
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  coverUrl: string | null;
  items: SourceItem[];
  truncated: boolean;
}

export async function getSpotifyPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
  if (!/^[A-Za-z0-9]{22}$/.test(playlistId)) throw err(SPOTIFY_NOT_FOUND, 404);

  const [page, oembed] = await Promise.all([
    get(`${BASE}/embed/playlist/${playlistId}`).catch((e: unknown) => {
      serverLogger.error('spotify', `embed fetch failed: ${(e as Error).message}`, { playlistId });
      return null;
    }),
    getOEmbed(playlistId),
  ]);
  if (!page) throw err(SPOTIFY_UNREACHABLE, 502);
  if (page.status === 404) throw err(SPOTIFY_NOT_FOUND, 404);
  if (!page.ok) {
    serverLogger.error('spotify', `embed page answered ${page.status}`, { playlistId, status: page.status });
    throw err(SPOTIFY_UNREACHABLE, 502);
  }

  let parsed;
  try {
    parsed = parseEmbedPage(await page.text());
  } catch (e) {
    if (e instanceof EmbedError && e.kind === 'not-found') throw err(SPOTIFY_NOT_FOUND, 404);
    serverLogger.error('spotify', `embed page unreadable: ${(e as Error).message}`, { playlistId });
    throw err(SPOTIFY_UNREADABLE, 502);
  }
  if (!parsed.items.length) throw err(SPOTIFY_EMPTY, 422);

  return {
    id: playlistId,
    name: oembed?.title ?? parsed.name,
    coverUrl: oembed?.thumbnail ?? parsed.coverUrl,
    items: parsed.items,
    truncated: parsed.mayBeTruncated,
  };
}

/** Follow a spotify.link short link to the playlist id it points at. The
 *  host is fixed by parseImportUrl, so this never fetches an arbitrary URL. */
export async function resolveSpotifyShortLink(url: string): Promise<string> {
  let res: Response;
  try {
    res = await get(url);
  } catch {
    throw err(SPOTIFY_UNREACHABLE, 502);
  }
  const direct = parseImportUrl(res.url);
  if (direct?.source === 'spotify') return direct.id;
  // Some short links land on an app-open page that names the target in its
  // HTML instead of redirecting.
  const body = await res.text().catch(() => '');
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/.exec(body);
  if (m) return m[1];
  throw err("That Spotify link doesn't point at a playlist. Paste a playlist link instead.", 400);
}
