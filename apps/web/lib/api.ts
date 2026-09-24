import type { AlbumDetail, ArtistPayload, CollectionTrack, Playlist, SessionState, Track } from '@/types/track';
import type { CopyOutcome } from '@/lib/playlistCopy';
import { logger } from '@/lib/logger/client';
import { isPublicPage } from '@/lib/publicPaths';
import { sessionExpired } from '@/lib/sessionExpired';
import type { ImportItem, ImportJob, InspectResult, JobKind } from '@/lib/import/types';
import type { TransferPreview } from '@/app/api/import/upload/route';
import type { FlowState as GoogleFlowState, GooglePreview } from '@/lib/import/google/flows';
import type { TabSummary } from '@/lib/tabSources';
import type { TabTiming } from '@/lib/tabSync';
import type { StoredPlugins } from '@/lib/pluginSettings';
import type { PresetId, ThemeDoc, ThemeInputs } from '@/lib/theme/model';
import type { SavedTheme, ThemeSelection, ThemesList } from '@/lib/theme/saved';
import type {
  PrankAck,
  PrankLogEntry,
  PrankParams,
  PrankPerson,
  PrankRow,
  PrankSchedule,
  PrankSound,
  PrankSoundKind,
  PresenceReport,
} from '@/lib/pranks/types';

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
  /** Statuses that are an answer, not a fault (a cap reached, a refusal
   *  with reasons): logged as a warning, so they never trigger a silent
   *  crash report. The error still throws, carrying the response body. */
  expected?: number[];
}

async function req<T>(path: string, { method = 'GET', body, signal, expected }: ReqOptions = {}): Promise<T> {
  let res: Response;
  // A FormData body carries its own multipart boundary: setting the header
  // by hand would strip it and the upload would arrive unreadable.
  const form = body instanceof FormData;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: body && !form ? { 'Content-Type': 'application/json' } : undefined,
      body: form ? (body as FormData) : body ? JSON.stringify(body) : undefined,
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
    // proxy.ts stamps every response with x-request-id; surfacing it here
    // lets triage line up this client-side entry with the matching
    // server-side withRequestLog entry for the same request.
    const reqId = res.headers.get('x-request-id') || undefined;
    const entry = { method, path, status: res.status, body: err.error, reqId };
    // A 401 is an answer too (the session is gone), not a fault: as an error
    // it sent an automatic bug report per call (bughunt V5).
    if (res.status === 401 || expected?.includes(res.status)) logger.warn('api', `${method} ${path} → ${res.status}`, entry);
    else logger.error('api', `${method} ${path} → ${res.status}`, entry);
    // Attach the HTTP status so callers can branch on it (e.g. 400 = duplicate
    // → friendly "already in playlist" toast instead of the raw server text).
    const error = new Error(err.error || `Request failed: ${res.status}`) as Error & { status?: number; body?: unknown };
    error.status = res.status;
    error.body = err;
    // The session expired or was never there (proxy.ts answers unauth /api/*
    // with this same 401 JSON, see bughunt W05): drop it, so every other
    // signed-in fetch stops (bughunt V5), and send the browser to sign in
    // rather than let every caller handle it. Public pages (/auth itself,
    // /track, /privacy, /terms) stay where they are: they work signed out.
    if (res.status === 401 && typeof window !== 'undefined') {
      sessionExpired();
      if (!isPublicPage(window.location.pathname)) {
        const next = window.location.pathname + window.location.search;
        window.location.href = `/auth?next=${encodeURIComponent(next)}`;
      }
    }
    throw error;
  }
  return (await res.json()) as T;
}

/** Like req, but silent: no client log entry on failure. The target's side
 *  of pranks goes through this, so nothing on their device (console, bug
 *  reports) ever mentions one. */
async function quiet<T>(path: string, { method = 'GET', body }: ReqOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    if (res.status === 401) sessionExpired();
    throw Object.assign(new Error(`Request failed: ${res.status}`), { status: res.status });
  }
  return (await res.json()) as T;
}

/** A file goes as multipart so it is never turned into a JSON string;
 *  pasted text goes as plain JSON. */
function transferBody(input: { file?: File; text?: string; destination?: JobKind }): FormData | { text: string; destination?: JobKind } {
  if (!input.file) return { text: input.text ?? '', ...(input.destination ? { destination: input.destination } : {}) };
  const form = new FormData();
  form.append('file', input.file);
  if (input.destination) form.append('destination', input.destination);
  return form;
}

export const api = {
  search: (q: string) => req<{ tracks: Track[] }>(`/search?q=${encodeURIComponent(q ?? '')}`),
  getTrending: () =>
    req<{ tracks: Track[]; title: string | null; country: string; fetchedAt: string | null; stale: boolean }>('/youtube/trending'),
  getRecommended: (seedSourceId?: string) =>
    req<{ tracks: Track[] }>(`/youtube/recommended${seedSourceId ? `?seed=${encodeURIComponent(seedSourceId)}` : ''}`),
  getArtist: (channelId: string) => req<ArtistPayload>(`/youtube/artist/${encodeURIComponent(channelId)}`),
  getAlbum: (browseId: string) => req<AlbumDetail>(`/youtube/album/${encodeURIComponent(browseId)}`),
  getTrack: (videoId: string) => req<{ track: Track }>(`/youtube/track/${encodeURIComponent(videoId)}`),
  getTrackAvailability: (id: string) =>
    req<{ unavailable: boolean; reason: string | null }>(`/tracks/${encodeURIComponent(id)}/availability`),
  getReplacements: (id: string) =>
    req<{ candidates: Track[] }>(`/tracks/${encodeURIComponent(id)}/replacements`),
  saveToServer: (videoId: string) =>
    req<{ ok: true; filePath: string }>(`/youtube/download/${encodeURIComponent(videoId)}`, { method: 'POST' }),

  listPlaylists: () => req<{ playlists: Playlist[] }>('/playlists'),
  createPlaylist: (name: string) =>
    req<{ playlist: Playlist }>('/playlists', { method: 'POST', body: { name } }),
  getPlaylist: (id: string) => req<{ playlist: Playlist; tracks: CollectionTrack[] }>(`/playlists/${id}`),
  /** Copy songs into a playlist: the server skips the ones already there
   *  (lib/playlistCopy's rule) and says which. */
  bulkAddToPlaylist: (id: string, tracks: Track[]) =>
    req<CopyOutcome>(`/playlists/${id}/tracks/bulk`, { method: 'POST', body: { tracks } }),
  addToPlaylist: (id: string, track: Track) =>
    req<{ ok: true }>(`/playlists/${id}/tracks`, { method: 'POST', body: { track } }),
  removeFromPlaylist: (id: string, trackId: string) =>
    req<{ ok: true }>(`/playlists/${id}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),
  replaceInPlaylist: (playlistId: string, trackId: string, track: Track) =>
    req<{ ok: true; merged: boolean; track: Track }>(
      `/playlists/${playlistId}/tracks/${encodeURIComponent(trackId)}/replace`,
      { method: 'POST', body: { track } },
    ),
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
  /** Inspect a pasted playlist link for the create dialog's preview. */
  importInspect: (url: string) =>
    req<InspectResult>('/import/inspect', { method: 'POST', body: { url } }),
  /** Queue the import of a pasted link. The default destination creates the
   *  playlist now; `liked` makes its songs likes and returns no playlist. */
  importStart: (url: string, destination: JobKind = 'playlist') =>
    req<{ job: ImportJob; playlistId: string | null }>('/import/jobs', {
      method: 'POST',
      body: { url, destination },
    }),
  /** What is in an uploaded file or a pasted list, without starting
   *  anything. */
  transferPreview: (input: { file?: File; text?: string }) =>
    req<{ preview: TransferPreview }>('/import/upload?preview=1', { method: 'POST', body: transferBody(input) }),
  /** Queue a transfer from an uploaded file or a pasted list. */
  transferStart: (input: { file?: File; text?: string; destination?: JobKind }) =>
    req<{ job: ImportJob; playlistId: string | null }>('/import/upload', { method: 'POST', body: transferBody(input) }),
  /** Is Google sign-in set up on this server? */
  googleLikesConfig: () => req<{ configured: boolean }>('/import/liked/google'),
  /** A new Google sign-in for the YouTube Music likes: the code to type on
   *  Google's page. No token ever comes back here, only the flow's id. */
  googleLikesBegin: () =>
    req<{ flowId: string; userCode: string; verificationUrl: string; expiresIn: number; interval: number }>(
      '/import/liked/google',
      { method: 'POST' },
    ),
  /** How that sign-in stands; `checking` while YouTube Music says which
   *  likes are songs, `preview` once it has. */
  googleLikesStatus: (flowId: string) =>
    req<{ state: GoogleFlowState; preview?: GooglePreview; checking?: { done: number; total: number }; message?: string }>(
      `/import/liked/google/${encodeURIComponent(flowId)}`,
    ),
  /** Queue the transfer of the likes that sign-in read. */
  googleLikesStart: (flowId: string) =>
    req<{ job: ImportJob; playlistId: null; truncated: boolean; note: string | null }>(
      `/import/liked/google/${encodeURIComponent(flowId)}/start`,
      { method: 'POST' },
    ),
  /** Cancel it: the server revokes whatever Google handed out. */
  googleLikesCancel: (flowId: string) =>
    req<{ cancelled: boolean }>(`/import/liked/google/${encodeURIComponent(flowId)}`, { method: 'DELETE' }),
  listImportJobs: () => req<{ jobs: ImportJob[] }>('/import/jobs'),
  getImportJob: (id: string) => req<{ job: ImportJob; items: ImportItem[] }>(`/import/jobs/${encodeURIComponent(id)}`),
  updateImportJob: (id: string, action: 'cancel' | 'retry' | 'dismiss') =>
    req<{ job: ImportJob }>(`/import/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action } }),
  /** Settle one imported song: put `track` in at its source position, or
   *  leave the song out. */
  pickImportItem: (id: string, track: Track) =>
    req<{ item: ImportItem; job: ImportJob }>(`/import/items/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { action: 'pick', track },
    }),
  skipImportItem: (id: string) =>
    req<{ item: ImportItem; job: ImportJob }>(`/import/items/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { action: 'skip' },
    }),
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

  listLikes: () => req<{ tracks: CollectionTrack[] }>('/likes'),
  /** Like many songs at once (copying into Liked songs). `confirmed` is the
   *  member's yes to "this likes every one of them": the route refuses
   *  without it. */
  bulkLike: (tracks: Track[]) =>
    req<CopyOutcome>('/likes/bulk', { method: 'POST', body: { tracks, confirmed: true } }),
  like: (track: Track) => req<{ ok: true }>('/likes', { method: 'POST', body: { track } }),
  unlike: (trackId: string) =>
    req<{ ok: true }>(`/likes/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),

  /** Guitar tabs for a track (Songsterr). Links only — they block embedding. */
  getTabs: (title: string, artist: string) =>
    req<{ matches: { id: number; artist: string; title: string; hasChords: boolean; instruments: string[]; url: string }[] }>(
      `/tabs?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
    ),
  /** Every tab for one track, files and generated alike, file first: the
   *  source chain the tab page picks from. */
  getTrackTabs: (trackId: string, title: string, artist: string) =>
    req<{ tabs: TabFile[] }>(
      `/tabs/files?kind=all&trackId=${encodeURIComponent(trackId)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
    ),
  /** Add a Guitar Pro or MusicXML file for a song. Multipart, so it
   *  bypasses the JSON `req` helper. */
  uploadTabFile: async (file: File, meta: { title: string; artist: string; trackId?: string }): Promise<{ tab: TabFile }> => {
    const form = new FormData();
    form.append('file', file);
    form.append('title', meta.title || file.name);
    form.append('artist', meta.artist);
    if (meta.trackId) form.append('trackId', meta.trackId);
    const res = await fetch(`${API_BASE}/api/tabs/files`, { method: 'POST', body: form, credentials: 'include' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'That file could not be added.');
    }
    return (await res.json()) as { tab: TabFile };
  },
  /** Save a tab's sync nudge for everyone (its uploader or an admin). */
  saveTabOffset: (id: string, offsetMs: number) =>
    req<{ tab: TabFile }>(`/tabs/files/${id}`, { method: 'PATCH', body: { offsetMs } }),
  deleteTabFile: (id: string) => req<{ ok: true }>(`/tabs/files/${id}`, { method: 'DELETE' }),
  /** A tab generated from the recording itself. GET is a status probe: the
   *  alphaTex body is fetched by the tab page straight from the URL. */
  getGeneratedTab: async (
    trackId: string,
  ): Promise<{ status: 'ready' | 'running' | 'failed' | 'none'; error?: string; code?: string }> => {
    const res = await fetch(`${API_BASE}/api/tabs/generated/${encodeURIComponent(trackId)}`, { credentials: 'include' });
    if (res.status === 200) return { status: 'ready' };
    if (res.status === 202) return { status: 'running' };
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      return { status: 'failed', error: body.error, code: body.code };
    }
    return { status: 'none' };
  },
  /** What this server can do for tabs beyond drawing them: whether the
   *  optional tools that generate one are installed. */
  getTabTools: () =>
    req<{ generate: { available: boolean; missing: string[]; code?: string; message?: string } }>('/tabs/tools'),
  /** Look for the song's tab online (Ultimate Guitar). Once per song: the
   *  server answers "cached" when it was searched before; `again` searches
   *  anew (the ⋯ menu's "Search online again"). */
  findTabsOnline: (trackId: string, title: string, artist: string, again = false) =>
    req<{ status: 'found' | 'none' | 'cached' | 'failed'; searchedAt: string | null; added: number }>('/tabs/online', {
      method: 'POST',
      body: { trackId, title, artist, again },
    }),
  /** How a tab's alignment with the recording stands (docs/tabs-v3.md
   *  section 3), and starting it ("Line it up"). */
  getTabAlignment: (tabId: string) =>
    req<{ status: 'ready' | 'running' | 'failed' | 'none'; timing?: TabTiming; error?: string }>(
      `/tabs/align?tabId=${encodeURIComponent(tabId)}`,
    ),
  lineTabUp: (tabId: string) => req<{ status: 'running' }>('/tabs/align', { method: 'POST', body: { tabId } }),
  generateTab: (trackId: string, title: string, artist = '') =>
    req<{ status: 'ready' | 'running' }>(
      `/tabs/generated/${encodeURIComponent(trackId)}?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
      { method: 'POST' },
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

  updateDiscord: (track: Track | null, isPlaying: boolean, positionSec = 0, durationSec = 0) =>
    req<{ ok: true; shared: boolean }>('/discord/update', {
      method: 'POST',
      body: { track, isPlaying, positionSec, durationSec },
    }),

  // — Privacy: two independent "don't broadcast what I'm playing" switches —
  getPrivacy: () => req<{ shareDiscord: boolean; shareListening: boolean }>('/privacy'),
  updatePrivacy: (patch: { shareDiscord?: boolean; shareListening?: boolean }) =>
    req<{ shareDiscord: boolean; shareListening: boolean }>('/privacy', {
      method: 'PATCH',
      body: patch,
    }),

  // What's new: the version last marked read and "Don't show New tags", per user.
  getChangelog: () => req<{ seenVersion: string; hideNew: boolean }>('/changelog'),
  updateChangelog: (patch: { seenVersion?: string; hideNew?: boolean }) =>
    req<{ seenVersion: string; hideNew: boolean }>('/changelog', {
      method: 'PATCH',
      body: patch,
    }),

  // Plugin switches (Settings > Plugins), per user. A missing key was never saved.
  getPlugins: () => req<StoredPlugins>('/plugins'),
  updatePlugins: (patch: StoredPlugins) =>
    req<StoredPlugins>('/plugins', {
      method: 'PATCH',
      body: patch,
    }),

  // Themes (Settings > Appearance). The active theme follows the account;
  // saved themes are a list per person, each optionally shared with
  // everyone. 409 (the cap) and 422 (unreadable colours, with `findings`
  // on error.body) are answers the page shows, not faults.
  getTheme: () => req<ThemeDoc>('/theme'),
  setTheme: (selection: ThemeSelection) =>
    req<ThemeDoc>('/theme', { method: 'PATCH', body: selection, expected: [404, 422] }),
  listThemes: () => req<ThemesList>('/themes'),
  createTheme: (theme: { name: string; base: PresetId; inputs: ThemeInputs; shared?: boolean }) =>
    req<{ theme: SavedTheme }>('/themes', { method: 'POST', body: theme, expected: [409, 422] }),
  duplicateTheme: (id: string, name?: string) =>
    req<{ theme: SavedTheme }>('/themes', {
      method: 'POST',
      body: name === undefined ? { duplicateOf: id } : { duplicateOf: id, name },
      expected: [404, 409],
    }),
  updateSavedTheme: (id: string, patch: { name?: string; base?: PresetId; inputs?: ThemeInputs; shared?: boolean }) =>
    req<{ theme: SavedTheme; active?: ThemeDoc }>(`/themes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
      expected: [422],
    }),
  deleteSavedTheme: (id: string) =>
    req<{ ok: true; active?: ThemeDoc }>(`/themes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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

    listInvites: () => req<{ invites: AdminInvite[] }>('/admin/invites'),
    addInvite: (email: string) =>
      req<{ ok: true; invite: AdminInvite }>('/admin/invites', { method: 'POST', body: { email } }),
    deleteInvite: (id: string) =>
      req<{ ok: true }>(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    pranks: {
      list: (target?: string) =>
        req<{ pranks: PrankLogEntry[]; enabled: boolean }>(
          `/admin/pranks${target ? `?target=${encodeURIComponent(target)}` : ''}`,
        ),
      send: (body: { targetId: string; kind: 'ping' | 'sound'; soundId?: string; params?: Partial<PrankParams> }) =>
        req<{ prank: PrankLogEntry }>('/admin/pranks', { method: 'POST', body }),
      people: () => req<{ people: PrankPerson[] }>('/admin/pranks/people'),
      settings: () => req<{ enabled: boolean; forcedOff: boolean }>('/admin/pranks/settings'),
      setEnabled: (enabled: boolean) =>
        req<{ enabled: boolean; cancelled: number }>('/admin/pranks/settings', { method: 'PATCH', body: { enabled } }),
      sounds: () => req<{ sounds: PrankSound[] }>('/admin/pranks/sounds'),
      uploadSound: (input: { file: File; kind: PrankSoundKind; name?: string }) => {
        const form = new FormData();
        form.append('file', input.file);
        form.append('kind', input.kind);
        if (input.name) form.append('name', input.name);
        return req<{ sound: PrankSound }>('/admin/pranks/sounds', { method: 'POST', body: form });
      },
      renameSound: (id: string, name: string) =>
        req<{ sound: PrankSound }>(`/admin/pranks/sounds/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
      deleteSound: (id: string) =>
        req<{ ok: true }>(`/admin/pranks/sounds/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      schedules: () => req<{ schedules: PrankSchedule[] }>('/admin/pranks/schedules'),
      repeat: (body: {
        targetId: string;
        soundId: string;
        intervalSec: number;
        endsAt: string;
        params?: Partial<PrankParams>;
      }) => req<{ schedule: PrankSchedule }>('/admin/pranks/schedules', { method: 'POST', body }),
      stopRepeat: (id: string) =>
        req<{ ok: true; cancelled: number }>(`/admin/pranks/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      stopAll: () => req<{ stopped: number; cancelled: number }>('/admin/pranks/stop-all', { method: 'POST' }),
    },
  },

  /** The target's side: quiet on purpose (see quiet()). */
  pranks: {
    inbox: () => quiet<{ pranks: PrankRow[] }>('/pranks/inbox'),
    ack: (id: string, body: PrankAck) =>
      quiet<{ ok: true }>(`/pranks/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    presence: (body: PresenceReport) => quiet<{ ok: true }>('/pranks/presence', { method: 'POST', body }),
  },
};

/** One row of the tab store. */
export type TabFile = TabSummary;
