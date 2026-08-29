import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { ForbiddenError, requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { serverLogger } from '@/lib/logger/server';
import { resolveTabPath } from '@/lib/tabs';

/** Delete one of your own tabs — the record and the file behind it. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/tabs/files/[id]'>) {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;
    const pb = await createAdminClient();

    const row = await pb.collection('tabs').getOne(id).catch(() => null);
    if (!row) return jsonError('That tab does not exist.', 404);
    if (row.user !== user.id) throw new ForbiddenError('That tab is not yours.');

    const full = resolveTabPath(String(row.file));
    await pb.collection('tabs').delete(id);
    if (full) {
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
}
