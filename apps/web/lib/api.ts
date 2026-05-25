import type { ArtistPayload, Playlist, Track } from '@/types/track';

// Cookies handle auth (PocketBase `pb_auth` cookie) — no manual Bearer headers.
// API_BASE stays empty for the web build (same-origin); a Capacitor/native
// shell can set NEXT_PUBLIC_API_BASE_URL to the server's URL.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
export const apiUrl = (relPath: string) => `${API_BASE}${relPath}`;

interface ReqOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function req<T>(path: string, { method = 'GET', body, signal }: ReqOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    signal,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  search: (q: string) => req<{ tracks: Track[] }>(`/search?q=${encodeURIComponent(q ?? '')}`),
  getTrack: (id: string) => req<{ track: Track }>(`/tracks/${encodeURIComponent(id)}`),
  getTrending: () => req<{ tracks: Track[] }>('/youtube/trending'),
  getRecommended: (seedSourceId?: string) =>
    req<{ tracks: Track[] }>(`/youtube/recommended${seedSourceId ? `?seed=${encodeURIComponent(seedSourceId)}` : ''}`),
  getArtist: (channelId: string) => req<ArtistPayload>(`/youtube/artist/${encodeURIComponent(channelId)}`),
  saveToServer: (videoId: string) =>
    req<{ ok: true; filePath: string }>(`/youtube/download/${encodeURIComponent(videoId)}`, { method: 'POST' }),

  listPlaylists: () => req<{ playlists: Playlist[] }>('/playlists'),
  createPlaylist: (name: string) =>
    req<{ playlist: Playlist }>('/playlists', { method: 'POST', body: { name } }),
  getPlaylist: (id: string) => req<{ playlist: Playlist; tracks: Track[] }>(`/playlists/${id}`),
  addToPlaylist: (id: string, track: Track) =>
    req<{ ok: true }>(`/playlists/${id}/tracks`, { method: 'POST', body: { track } }),
  removeFromPlaylist: (id: string, trackId: string) =>
    req<{ ok: true }>(`/playlists/${id}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),
  deletePlaylist: (id: string) => req<{ ok: true }>(`/playlists/${id}`, { method: 'DELETE' }),

  listLikes: () => req<{ tracks: Track[] }>('/likes'),
  like: (track: Track) => req<{ ok: true }>('/likes', { method: 'POST', body: { track } }),
  unlike: (trackId: string) =>
    req<{ ok: true }>(`/likes/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),

  getHistory: () => req<{ tracks: Track[] }>('/history'),
  recordPlay: (track: Track) => req<{ ok: true }>('/history', { method: 'POST', body: { track } }),

  updateDiscord: (track: Track | null, isPlaying: boolean) =>
    req<{ ok: true }>('/discord/update', { method: 'POST', body: { track, isPlaying } }),
};
