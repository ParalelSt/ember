import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { applyNavPatch, atNavCap, parseNavPatch, pruneNavPrefs, readNavPrefs, type NavPrefs } from '@/lib/navPlaylists';
import { collabClient, sharedWith } from '@/lib/playlistAccess';
import type PocketBase from 'pocketbase';

/** Per-user order of the Sidebar / Drawer playlists, synced across devices.
 *
 *  GET   → { pinned: string[], opened: Record<id, ms> }
 *  PATCH → { pin: id, pinned: boolean }  pin or unpin one playlist
 *        | { opened: id }                it was just opened (server time)
 *
 *  Only ever reads and writes the signed-in user's own row (the id comes from
 *  the session, never the request). The field is added on boot by
 *  pb_hooks/ensure_nav_playlists.pb.js; the logic is in lib/navPlaylists.ts. */

/** One user's PATCHes, in order: each is a read-merge-write of the whole
 *  field, so two in flight would otherwise drop each other's change. Same
 *  shape as api/plugins. */
const locks = new Map<string, Promise<unknown>>();

function withNavLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(userId) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  locks.set(userId, tail);
  void tail.then(() => {
    if (locks.get(userId) === tail) locks.delete(userId);
  });
  return run;
}

/** Every playlist id the user can still open: their own and the shared
 *  ones. Null when the shared list cannot be read, so nothing is dropped
 *  on a guess. */
async function liveIds(pb: PocketBase, userId: string): Promise<Set<string> | null> {
  try {
    const own = await pb.collection('playlists').getFullList({ filter: `user = "${userId}"`, fields: 'id' });
    const shared = await sharedWith(await collabClient(), userId);
    return new Set([...own, ...shared].map((p) => p.id));
  } catch {
    return null;
  }
}

export const GET = withRequestLog('nav-playlists', async () => {
  try {
    const { pb, user } = await requireUser();
    const record = await pb.collection('users').getOne(user.id);
    return Response.json(readNavPrefs(record.navPlaylists) satisfies NavPrefs);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const PATCH = withRequestLog('nav-playlists', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const patch = parseNavPatch(await request.json().catch(() => null));
    if (!patch) {
      return Response.json({ error: 'Expected { pin, pinned } or { opened } with a playlist id' }, { status: 400 });
    }
    const updated = await withNavLock(user.id, async () => {
      const record = await pb.collection('users').getOne(user.id);
      let prefs = readNavPrefs(record.navPlaylists);
      // At a cap, deleted playlists would push out live pins and open
      // times: drop them first. Only then, so a normal open costs no query.
      if (atNavCap(prefs)) {
        const live = await liveIds(pb, user.id);
        if (live) prefs = pruneNavPrefs(prefs, live);
      }
      const next = applyNavPatch(prefs, patch, Date.now());
      return pb.collection('users').update(user.id, { navPlaylists: next });
    });
    return Response.json(readNavPrefs(updated.navPlaylists) satisfies NavPrefs);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
