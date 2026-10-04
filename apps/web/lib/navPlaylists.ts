/** Order of the playlists in the Sidebar and Drawer: pinned ones first (newest
 *  pin on top), then the rest by when they were last opened, most recent
 *  first. Never-opened playlists and ties keep the order the library gave
 *  them. Stored per user in the `navPlaylists` JSON field
 *  (pb_hooks/ensure_nav_playlists.pb.js) so it follows the account. */

export interface NavPrefs {
  /** Playlist ids held at the top, newest pin first. */
  pinned: string[];
  /** Playlist id to when it was last opened (ms, server time). */
  opened: Record<string, number>;
}

export const EMPTY_NAV_PREFS: NavPrefs = { pinned: [], opened: {} };

/** Caps keep the stored document small however long someone uses the app. */
export const MAX_PINNED = 200;
export const MAX_OPENED = 300;

/** A PocketBase record id (15 chars) with room to spare. */
export const isPlaylistId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The usable part of whatever the field holds. */
export function readNavPrefs(raw: unknown): NavPrefs {
  if (!isPlainObject(raw)) return { pinned: [], opened: {} };
  const pinned = Array.isArray(raw.pinned)
    ? [...new Set(raw.pinned.filter(isPlaylistId))].slice(0, MAX_PINNED)
    : [];
  const opened: Record<string, number> = {};
  if (isPlainObject(raw.opened)) {
    for (const [id, at] of Object.entries(raw.opened)) {
      if (isPlaylistId(id) && typeof at === 'number' && Number.isFinite(at) && at > 0) opened[id] = at;
    }
  }
  return { pinned, opened };
}

export type NavPatch = { pin: string; pinned: boolean } | { opened: string };

/** A PATCH body: pin or unpin one playlist, or note that one was opened. */
export function parseNavPatch(body: unknown): NavPatch | null {
  if (!isPlainObject(body)) return null;
  const keys = Object.keys(body);
  if (keys.length === 2 && isPlaylistId(body.pin) && typeof body.pinned === 'boolean') {
    return { pin: body.pin, pinned: body.pinned };
  }
  if (keys.length === 1 && isPlaylistId(body.opened)) return { opened: body.opened };
  return null;
}

/** The prefs after a patch. `now` is the open time for an `opened` patch. */
export function applyNavPatch(prefs: NavPrefs, patch: NavPatch, now: number): NavPrefs {
  if ('opened' in patch) {
    const opened = { ...prefs.opened, [patch.opened]: now };
    const ids = Object.keys(opened);
    if (ids.length > MAX_OPENED) {
      // Drop the oldest; a pinned playlist's time is kept regardless.
      const keep = new Set(prefs.pinned);
      const drop = ids
        .filter((id) => !keep.has(id) && id !== patch.opened)
        .sort((a, b) => opened[a] - opened[b])
        .slice(0, ids.length - MAX_OPENED);
      for (const id of drop) delete opened[id];
    }
    return { pinned: prefs.pinned, opened };
  }
  const rest = prefs.pinned.filter((id) => id !== patch.pin);
  const pinned = patch.pinned ? [patch.pin, ...rest].slice(0, MAX_PINNED) : rest;
  return { pinned, opened: prefs.opened };
}

/** `items` ordered by the prefs; each also says whether it is pinned. */
export function orderNavPlaylists<T extends { id: string }>(items: T[], prefs: NavPrefs): (T & { pinned: boolean })[] {
  const pinRank = new Map(prefs.pinned.map((id, i) => [id, i]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = pinRank.get(a.item.id);
      const pb = pinRank.get(b.item.id);
      if (pa !== undefined || pb !== undefined) {
        if (pa === undefined) return 1;
        if (pb === undefined) return -1;
        return pa - pb;
      }
      const oa = prefs.opened[a.item.id] ?? 0;
      const ob = prefs.opened[b.item.id] ?? 0;
      return ob - oa || a.index - b.index;
    })
    .map(({ item }) => ({ ...item, pinned: pinRank.has(item.id) }));
}
