import 'server-only';
import { serverLogger } from '@/lib/logger/server';

/** Read-only Spotify Web API access for playlist import. Uses the
 *  client-credentials flow — reads PUBLIC user-created playlists only.
 *  Spotify-owned editorial/algorithmic playlists 404 for basic apps (expected;
 *  callers surface a friendly message). Host setup: create a (free) app at
 *  developer.spotify.com and set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET. */

interface StatusError extends Error {
  status?: number;
}

function err(message: string, status: number): StatusError {
  const e: StatusError = new Error(message);
  e.status = status;
  return e;
}

export function spotifyConfigured(): boolean {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

let cachedToken: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (!spotifyConfigured()) {
    throw err('Spotify import is not set up on this server yet.', 501);
  }
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) {
    serverLogger.error('spotify', `token request failed: ${res.status}`, { status: res.status });
    throw err('Could not reach Spotify — check the server keys.', 502);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.token;
}

export interface SpotifyPlaylistItem {
  title: string;
  artist: string;
}

interface RawPlaylistTrack {
  track: {
    name?: string;
    type?: string;
    is_local?: boolean;
    artists?: { name?: string }[];
  } | null;
}

async function spotifyGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) {
    throw err(
      "Spotify couldn't find that playlist. It must be public and user-created — Spotify's own editorial playlists can't be imported.",
      404,
    );
  }
  if (!res.ok) {
    serverLogger.error('spotify', `GET ${path} → ${res.status}`, { status: res.status });
    throw err('Spotify request failed — try again in a moment.', 502);
  }
  return (await res.json()) as T;
}

/** Playlist name + full track list (title/artist), following pagination. */
export async function getSpotifyPlaylist(playlistId: string): Promise<{ name: string; items: SpotifyPlaylistItem[] }> {
  const head = await spotifyGet<{
    name?: string;
    tracks: { items: RawPlaylistTrack[]; next: string | null; total: number };
  }>(`/playlists/${encodeURIComponent(playlistId)}?fields=name,tracks(items(track(name,type,is_local,artists(name))),next,total)`);

  const items: SpotifyPlaylistItem[] = [];
  const push = (raw: RawPlaylistTrack[]) => {
    for (const r of raw) {
      const t = r.track;
      // Skip podcast episodes and local files — they can't be matched.
      if (!t || t.is_local || (t.type && t.type !== 'track') || !t.name) continue;
      items.push({ title: t.name, artist: t.artists?.[0]?.name ?? '' });
    }
  };
  push(head.tracks.items);

  let offset = head.tracks.items.length;
  // `next` from the fields-filtered response is unreliable across API versions;
  // page by offset until we've seen `total` entries (cap at 1000 for sanity).
  const total = Math.min(head.tracks.total ?? offset, 1000);
  while (offset < total) {
    const page = await spotifyGet<{ items: RawPlaylistTrack[] }>(
      `/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset}&limit=100&fields=items(track(name,type,is_local,artists(name)))`,
    );
    if (!page.items.length) break;
    push(page.items);
    offset += page.items.length;
  }

  return { name: head.name ?? 'Imported playlist', items };
}
