import 'server-only';
import type PocketBase from 'pocketbase';
import { parseThemeDoc, type ThemeDoc } from '@/lib/theme/model';
import { problems } from '@/lib/theme/guard';
import type { ThemeInputs } from '@/lib/theme/model';

/** The active theme on the signed-in user's own row (users.theme), read and
 *  written with their own client: the users rules already limit that row
 *  to its owner. */
export async function readActive(pb: PocketBase, userId: string): Promise<ThemeDoc> {
  const record = await pb.collection('users').getOne(userId);
  return parseThemeDoc(record.theme);
}

export async function writeActive(pb: PocketBase, userId: string, doc: ThemeDoc): Promise<ThemeDoc> {
  const record = await pb.collection('users').update(userId, { theme: doc });
  return parseThemeDoc(record.theme);
}

/** One user's reads and writes of users.theme, in order: without this, an
 *  edit-save's "is this still active?" check and its write are two separate
 *  round trips, and a theme switch landing in between gets overwritten by
 *  the stale write that follows (bughunt N2). Everything below that reads
 *  then conditionally writes users.theme goes through here so the two can
 *  never interleave. POST /api/themes runs its cap check and create here
 *  too, so two creates at once cannot both pass the cap. */
const LOCKS_KEY = Symbol.for('ember.themeLocks');
/** The process's map, not this module copy's: PATCH /api/theme and the
 *  /api/themes routes each bundle their own copy (lib/sources/failureMemo),
 *  and a map per copy serialized nothing between them. */
const locks = ((globalThis as Record<symbol, unknown>)[LOCKS_KEY] ??= new Map()) as Map<string, Promise<unknown>>;

export function withThemeLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(userId) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const settled = run.then(
    () => {},
    () => {},
  );
  locks.set(userId, settled);
  // The last call in line removes the entry, so the map holds only users
  // with a call in flight instead of everyone who ever changed a theme.
  void settled.then(() => {
    if (locks.get(userId) === settled) locks.delete(userId);
  });
  return run;
}

/** How many users have a lock entry right now (for tests). */
export function themeLocksHeld(): number {
  return locks.size;
}

/** A switch (PATCH /api/theme): always writes, but still queued behind any
 *  edit-save in progress so it is never the one that gets clobbered. */
export function writeActiveLocked(pb: PocketBase, userId: string, doc: ThemeDoc): Promise<ThemeDoc> {
  return withThemeLock(userId, () => writeActive(pb, userId, doc));
}

/** Read-modify-write of users.theme, gated: only writes when the active
 *  theme still names `expectedThemeId` at write time (an edit-save whose
 *  theme is no longer in use, or a refreshed copy for a theme someone
 *  switched away from, is a no-op instead of a stale overwrite). Returns
 *  the new active doc, or undefined when the write was skipped. */
export async function writeActiveIfCurrent(
  pb: PocketBase,
  userId: string,
  expectedThemeId: string | undefined,
  next: ThemeDoc,
): Promise<ThemeDoc | undefined> {
  return withThemeLock(userId, async () => {
    const current = await readActive(pb, userId);
    if (current.themeId !== expectedThemeId) return undefined;
    return writeActive(pb, userId, next);
  });
}

/** 422 for colours with a failing readability pair. Never adjusted on the
 *  server: the person sees the findings and chooses a fix. */
export function unreadableResponse(inputs: ThemeInputs): Response | null {
  const fails = problems(inputs).filter((f) => f.level === 'fail');
  if (fails.length === 0) return null;
  return Response.json(
    {
      error: 'Fix the readability problems to save',
      findings: fails.map(({ pair, label, ratio }) => ({ pair, label, ratio })),
    },
    { status: 422 },
  );
}
