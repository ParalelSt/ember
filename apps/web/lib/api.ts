import type { AlbumDetail, ArtistPayload, Playlist, SessionState, Track } from '@/types/track';
import type { ServerLogEntry } from '@/lib/logger/types';
import { logger } from '@/lib/logger/client';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  created: string;
}

export interface AdminTrack extends Track {
  /** PocketBase internal record id — used in admin PATCH / DELETE URLs. */
  recordId: string;
}

export interface AdminInvite {
  id: string;
  email: string;
  created: string;
}

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
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal,
    });
  } catch (e) {
    // Network-level failure (offline, DNS, CORS, etc.). Log + rethrow.
    logger.error('api', `${method} ${path} network error`, { method, path }, e as Error);
    throw e;
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    logger.error('api', `${method} ${path} → ${res.status}`, { method, path, status: res.status, body: err.error });
    // Attach the HTTP status so callers can branch on it (e.g. 400 = duplicate
    // → friendly "already in playlist" toast instead of the raw server text).
    const error = new Error(err.error || `Request failed: ${res.status}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return (await res.json()) as T;
}

export const api = {
  search: (q: string) => req<{ tracks: Track[] }>(`/search?q=${encodeURIComponent(q ?? '')}`),
  getTrending: () => req<{ tracks: Track[] }>('/youtube/trending'),
  getRecommended: (seedSourceId?: string) =>
    req<{ tracks: Track[] }>(`/youtube/recommended${seedSourceId ? `?seed=${encodeURIComponent(seedSourceId)}` : ''}`),
  getArtist: (channelId: string) => req<ArtistPayload>(`/youtube/artist/${encodeURIComponent(channelId)}`),
  getAlbum: (browseId: string) => req<AlbumDetail>(`/youtube/album/${encodeURIComponent(browseId)}`),
  getTrack: (videoId: string) => req<{ track: Track }>(`/youtube/track/${encodeURIComponent(videoId)}`),
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
  // — Carlist live sessions —
  createSession: (body: { name?: string; seedPlaylistId?: string }) =>
    req<{ session: { id: string; code: string; name: string } }>('/sessions', { method: 'POST', body }),
  joinSession: (code: string) =>
    req<{ session: { id: string; name: string } }>('/sessions/join', { method: 'POST', body: { code } }),
  getSession: (id: string) => req<SessionState>(`/sessions/${id}`),
  addToSession: (id: string, track: Track) =>
    req<{ ok: true }>(`/sessions/${id}/tracks`, { method: 'POST', body: { track } }),
  skipSession: (id: string) => req<{ ok: true }>(`/sessions/${id}/skip`, { method: 'POST' }),
  consumeSessionCommands: (id: string) =>
    req<{ commands: { type: string }[] }>(`/sessions/${id}/commands/consume`, { method: 'POST' }),
  publishSessionNow: (id: string, index: number) =>
    req<{ ok: true }>(`/sessions/${id}/now`, { method: 'POST', body: { index } }),
  endSession: (id: string) => req<{ ok: true }>(`/sessions/${id}/end`, { method: 'POST' }),
  saveSession: (id: string, name?: string) =>
    req<{ playlist: { id: string; name: string } }>(`/sessions/${id}/save`, { method: 'POST', body: { name } }),
  /** Inspect a pasted Spotify / YT Music playlist link. YTM answers with
   *  ready Ember tracks; Spotify answers with raw items for importMatch. */
  importInspect: (url: string) =>
    req<
      | { source: 'ytmusic'; name: string; tracks: Track[] }
      | { source: 'spotify'; name: string; items: { title: string; artist: string }[] }
    >('/import/inspect', { method: 'POST', body: { url } }),
  /** Match ≤8 Spotify items onto YT Music (null = no match). */
  importMatch: (items: { title: string; artist: string }[]) =>
    req<{ tracks: (Track | null)[] }>('/import/match', { method: 'POST', body: { items } }),
  // — Recent searches (server-backed so they sync across devices) —
  listRecentSearches: () => req<{ tracks: Track[] }>('/recent-searches'),
  addRecentSearch: (track: Track) =>
    req<{ ok: true }>('/recent-searches', { method: 'POST', body: { track } }),
  removeRecentSearch: (trackId: string) =>
    req<{ ok: true }>(`/recent-searches/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),
  /** What other members played in the last ~30 min (newest per user). */
  listening: () =>
    req<{ items: { userName: string; playedAt: string; track: Track }[] }>('/listening'),
  deletePlaylist: (id: string) => req<{ ok: true }>(`/playlists/${id}`, { method: 'DELETE' }),
  /** Upload (or replace) a playlist cover image. Multipart, so it bypasses
   *  the JSON `req` helper. */
  updatePlaylistArtwork: async (id: string, file: File): Promise<{ playlist: Playlist }> => {
    const fd = new FormData();
    fd.append('artwork', file);
    const res = await fetch(`${API_BASE}/api/playlists/${id}/artwork`, {
      method: 'PATCH',
      body: fd,
      credentials: 'include',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return (await res.json()) as { playlist: Playlist };
  },

  listLikes: () => req<{ tracks: Track[] }>('/likes'),
  like: (track: Track) => req<{ ok: true }>('/likes', { method: 'POST', body: { track } }),
  unlike: (trackId: string) =>
    req<{ ok: true }>(`/likes/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),

  /** Guitar tabs for a track (Songsterr). Links only — they block embedding. */
  getTabs: (title: string, artist: string) =>
    req<{ matches: { id: number; artist: string; title: string; hasChords: boolean; instruments: string[]; url: string }[] }>(
      `/tabs?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
    ),
  // — Custom uploads (songs members add from their own files) —
  listUploads: () => req<{ tracks: Track[] }>('/uploads'),
  deleteUpload: (id: string) =>
    req<{ ok: true }>(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Multipart, so it bypasses the JSON `req` helper. `durationSec` is read
   *  in the browser — the server has no ffprobe to rely on. */
  uploadTrack: async (
    file: File,
    meta: { title: string; artist: string; album?: string; durationSec: number },
  ): Promise<{ track: Track }> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', meta.title);
    fd.append('artist', meta.artist);
    if (meta.album) fd.append('album', meta.album);
    fd.append('durationSec', String(Math.round(meta.durationSec)));
    const res = await fetch(`${API_BASE}/api/uploads`, { method: 'POST', body: fd, credentials: 'include' });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return (await res.json()) as { track: Track };
  },

  getHistory: () => req<{ tracks: Track[] }>('/history'),
  recordPlay: (track: Track) => req<{ ok: true }>('/history', { method: 'POST', body: { track } }),

  updateDiscord: (track: Track | null, isPlaying: boolean) =>
    req<{ ok: true; shared: boolean }>('/discord/update', { method: 'POST', body: { track, isPlaying } }),

  // — Privacy: two independent "don't broadcast what I'm playing" switches —
  getPrivacy: () => req<{ shareDiscord: boolean; shareListening: boolean }>('/privacy'),
  updatePrivacy: (patch: { shareDiscord?: boolean; shareListening?: boolean }) =>
    req<{ shareDiscord: boolean; shareListening: boolean }>('/privacy', {
      method: 'PATCH',
      body: patch,
    }),

  updateProfile: async ({
    name,
    avatar,
    removeAvatar,
  }: {
    name?: string;
    avatar?: File;
    removeAvatar?: boolean;
  }): Promise<{
    ok: true;
    user: { id: string; email: string; name: string; avatarUrl: string | null };
  }> => {
    const fd = new FormData();
    if (name !== undefined) fd.set('name', name);
    if (avatar) fd.set('avatar', avatar);
    if (removeAvatar) fd.set('removeAvatar', 'true');
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'PATCH',
      body: fd,
      credentials: 'include',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return res.json();
  },

  admin: {
    listUsers: () => req<{ users: AdminUser[] }>('/admin/users'),
    updateUser: (id: string, patch: { name?: string; isAdmin?: boolean }) =>
      req<{ ok: true; user: AdminUser }>(
        `/admin/users/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: patch },
      ),
    deleteUser: (id: string) =>
      req<{ ok: true }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    resetUserPassword: (id: string, password: string) =>
      req<{ ok: true; selfReset: boolean }>(
        `/admin/users/${encodeURIComponent(id)}/password`,
        { method: 'POST', body: { password } },
      ),

    listTracks: (params: { page?: number; q?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.page) qs.set('page', String(params.page));
      if (params.q) qs.set('q', params.q);
      const tail = qs.toString();
      return req<{
        tracks: AdminTrack[];
        page: number;
        totalPages: number;
        totalItems: number;
      }>(`/admin/tracks${tail ? `?${tail}` : ''}`);
    },
    updateTrack: (recordId: string, patch: { title?: string; artist?: string; album?: string }) =>
      req<{ ok: true; track: AdminTrack | null }>(
        `/admin/tracks/${encodeURIComponent(recordId)}`,
        { method: 'PATCH', body: patch },
      ),
    deleteTrack: (recordId: string) =>
      req<{ ok: true }>(`/admin/tracks/${encodeURIComponent(recordId)}`, { method: 'DELETE' }),

    listLogs: (params: { categories?: string[]; q?: string; limit?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.categories?.length) qs.set('category', params.categories.join(','));
      if (params.q) qs.set('q', params.q);
      if (params.limit) qs.set('limit', String(params.limit));
      const tail = qs.toString();
      return req<{ entries: ServerLogEntry[]; total: number }>(
        `/admin/logs${tail ? `?${tail}` : ''}`,
      );
    },
    clearLogs: () => req<{ ok: true }>('/admin/logs', { method: 'DELETE' }),

    listInvites: () => req<{ invites: AdminInvite[] }>('/admin/invites'),
    addInvite: (email: string) =>
      req<{ ok: true; invite: AdminInvite }>('/admin/invites', { method: 'POST', body: { email } }),
    deleteInvite: (id: string) =>
      req<{ ok: true }>(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};
