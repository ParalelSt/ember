import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { parsePluginPatch, readStoredPlugins, type StoredPlugins } from '@/lib/pluginSettings';

/** Per-user plugin switches (Settings > Plugins), synced across devices.
 *
 *  GET   → the stored switches; a missing key was never saved
 *  PATCH → { partyVolume?: boolean, tabsEnabled?: boolean, normalizeVolume?:
 *          boolean, equalizer?: { enabled, bands } }, merged in
 *
 *  Same shape as api/changelog. The field is added on boot by
 *  pb_hooks/ensure_plugin_settings.pb.js; the keys live in
 *  lib/pluginSettings.ts. */

/** One user's PATCHes, in order. Each is a read-merge-write of the whole
 *  `plugins` field: two in flight at once (a quick second toggle, the
 *  equalizer's delayed save landing next to a switch, the first-load
 *  migration) would both read the same row, and the later write would drop
 *  the earlier one's key. Same shape as the theme lock in
 *  lib/theme/serverActive.ts. */
const locks = new Map<string, Promise<unknown>>();

function withPluginsLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(userId) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  locks.set(userId, tail);
  // Drop the entry once nothing is queued behind this one.
  void tail.then(() => {
    if (locks.get(userId) === tail) locks.delete(userId);
  });
  return run;
}

export const GET = withRequestLog('plugins', async () => {
  try {
    const { pb, user } = await requireUser();
    const record = await pb.collection('users').getOne(user.id);
    return Response.json(readStoredPlugins(record.plugins) satisfies StoredPlugins);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const PATCH = withRequestLog('plugins', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const patch = parsePluginPatch(await request.json().catch(() => null));
    if (!patch) {
      return Response.json(
        { error: 'Expected known plugin keys with true or false (equalizer: { enabled, bands[5] })' },
        { status: 400 },
      );
    }

    // Merge into what is stored, keeping keys this build does not know about
    // (a newer build may have written them).
    const updated = await withPluginsLock(user.id, async () => {
      const record = await pb.collection('users').getOne(user.id);
      const current = typeof record.plugins === 'object' && record.plugins !== null && !Array.isArray(record.plugins)
        ? (record.plugins as Record<string, unknown>)
        : {};
      return pb.collection('users').update(user.id, { plugins: { ...current, ...patch } });
    });
    return Response.json(readStoredPlugins(updated.plugins) satisfies StoredPlugins);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
