import { supabase } from './supabase.js';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) Object.assign(headers, await authHeaders());
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  search: (q) => req(`/search?q=${encodeURIComponent(q ?? '')}`),
  getTrack: (id) => req(`/tracks/${encodeURIComponent(id)}`),
  getTrending: () => req('/youtube/trending'),

  listPlaylists: () => req('/playlists', { auth: true }),
  createPlaylist: (name) => req('/playlists', { method: 'POST', body: { name }, auth: true }),
  getPlaylist: (id) => req(`/playlists/${id}`, { auth: true }),
  addToPlaylist: (id, track) => req(`/playlists/${id}/tracks`, { method: 'POST', body: { track }, auth: true }),
  removeFromPlaylist: (id, trackId) => req(`/playlists/${id}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE', auth: true }),
  deletePlaylist: (id) => req(`/playlists/${id}`, { method: 'DELETE', auth: true }),

  listLikes: () => req('/likes', { auth: true }),
  like: (track) => req('/likes', { method: 'POST', body: { track }, auth: true }),
  unlike: (trackId) => req(`/likes/${encodeURIComponent(trackId)}`, { method: 'DELETE', auth: true }),

  getHistory: () => req('/history', { auth: true }),
  recordPlay: (track) => req('/history', { method: 'POST', body: { track }, auth: true }),

  updateDiscord: (track, isPlaying) => req('/discord/update', { method: 'POST', body: { track, isPlaying } }),
};
