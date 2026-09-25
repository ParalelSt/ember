import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { ForbiddenError, requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { serverLogger } from '@/lib/logger/server';
import { rowPaths } from '@/lib/tabs';
import { canDelete, canView, mapTab } from '@/lib/tabStore';
import { MAX_OFFSET_MS } from '@/lib/tabSync';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Delete a tab, the record and the files behind it (a pasted text tab has
 *  two: its alphaTex and the text). Only its uploader or an
 *  admin may; everyone else gets 403 for a shared tab and 404 for a private
 *  one (a private tab of someone else's does not exist for you). */
export const DELETE = withRequestLog('tabs/files/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/tabs/files/[id]'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;
    const pb = await createAdminClient();

    const row = await pb.collection('tabs').getOne(id).catch(() => null);
    if (!row || (!canView(row, user) && !user.isAdmin)) return jsonError('That tab does not exist.', 404);
    if (!canDelete(row, user)) throw new ForbiddenError('Only whoever added this tab can delete it.');

    const paths = rowPaths(row);
    await pb.collection('tabs').delete(id);
    for (const full of paths) {
      await fs.unlink(full).catch((err) => {
        // The record is gone either way; a missing file is not an error worth
        // failing the request over.
        serverLogger.error('api', 'tab file delete failed', { path: full }, err);
      });
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** Save a tab's sync nudge for everyone (`offset_ms`).
 *  Same permission as delete: whoever added it, or an admin.
 *  Everyone else keeps their own nudge on their device. */
export const PATCH = withRequestLog('tabs/files/[id]', async (request: NextRequest, ctx: RouteContext<'/api/tabs/files/[id]'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { offsetMs?: unknown } | null;
    const offsetMs = body?.offsetMs;
    if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs) || Math.abs(offsetMs) > MAX_OFFSET_MS) {
      return jsonError(`offsetMs must be a number between -${MAX_OFFSET_MS} and ${MAX_OFFSET_MS}`, 400);
    }
    const pb = await createAdminClient();
    const row = await pb.collection('tabs').getOne(id).catch(() => null);
    if (!row || (!canView(row, user) && !user.isAdmin)) return jsonError('That tab does not exist.', 404);
    if (!canDelete(row, user)) throw new ForbiddenError('Only whoever added this tab can change its sync.');
    const updated = await pb.collection('tabs').update(id, { offset_ms: Math.round(offsetMs) });
    return Response.json({ tab: mapTab(updated, user) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
