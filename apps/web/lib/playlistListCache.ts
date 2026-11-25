/** A short per-user memory of GET /api/playlists' answer, so a page's
 *  sidebar and Library asking within moments of each other cost PocketBase
 *  nothing the second time.
 *
 *  Any playlist change anywhere forgets every entry (playlistsChanged): the
 *  write routes call it through withRequestLog (PLAYLIST_WRITE_ROUTES) and
 *  the import runner calls it for the songs it adds. A shared playlist
 *  changes the lists of all its members, so one generation counter for the
 *  whole server is the simple, always-right choice at this size. A change
 *  made outside the app (PocketBase's admin UI) shows within the TTL.
 *
 *  Kept on globalThis so every route bundle shares one cache. No tokens,
 *  only user ids and the playlists' public fields. */

/** How long an answer is reused when nothing changed. */
export const PLAYLIST_LIST_TTL_MS = 2 * 60_000;
/** People remembered at once; the oldest goes first. */
export const PLAYLIST_LIST_MAX_USERS = 500;

interface Entry<T> {
  generation: number;
  expires: number;
  value: T;
}

interface State {
  generation: number;
  entries: Map<string, Entry<unknown>>;
}

const KEY = Symbol.for('ember.playlistListCache');
const state = ((globalThis as Record<symbol, unknown>)[KEY] ??= {
  generation: 0,
  entries: new Map(),
}) as State;

/** The current generation, read before the lookup starts, so an answer
 *  read while a change landed is not kept (rememberPlaylistList). */
export function playlistListGeneration(): number {
  return state.generation;
}

export function cachedPlaylistList<T>(userId: string, now = Date.now()): T | null {
  const hit = state.entries.get(userId);
  if (!hit) return null;
  if (hit.generation !== state.generation || hit.expires <= now) {
    state.entries.delete(userId);
    return null;
  }
  return hit.value as T;
}

/** Keep `value` for `userId`, unless a change landed since `generation`
 *  was read. */
export function rememberPlaylistList<T>(userId: string, generation: number, value: T, now = Date.now()): void {
  if (generation !== state.generation) return;
  state.entries.delete(userId);
  state.entries.set(userId, { generation, expires: now + PLAYLIST_LIST_TTL_MS, value });
  while (state.entries.size > PLAYLIST_LIST_MAX_USERS) {
    const oldest = state.entries.keys().next().value;
    if (oldest === undefined) break;
    state.entries.delete(oldest);
  }
}

/** Something about some playlist changed: forget every remembered list. */
export function playlistsChanged(): void {
  state.generation += 1;
  state.entries.clear();
}

/** Routes (withRequestLog names) whose writes can change what the list
 *  shows: names, covers, counts, who shares what, or the songs' covers. */
const PLAYLIST_WRITE_ROUTES = [
  /^playlists(\/|$)/,
  /^nav-playlists$/,
  /^sessions\/\[id\]\/save$/,
  /^import(\/|$)/,
  /^uploads(\/|$)/,
  /^tracks\//,
  /^admin\/(users|tracks|cleanup)(\/|$)/,
  /^profile$/,
];

/** True when a request to the route named `route` may have changed a
 *  playlist list: any non-read method on one of PLAYLIST_WRITE_ROUTES. */
export function changesPlaylists(route: string, method: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return PLAYLIST_WRITE_ROUTES.some((re) => re.test(route));
}

/** Tests only. */
export function _resetPlaylistListCache(): void {
  state.generation = 0;
  state.entries.clear();
}
