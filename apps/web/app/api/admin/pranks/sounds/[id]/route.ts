import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { resolvePrankPath, toPrankSound } from '@/lib/pranks/media';
import { prankErrorResponse } from '@/lib/pranks/server';

const MAX_NAME = 120;

const notFound = () => Response.json({ error: 'No such sound' }, { status: 404 });
const is404 = (e: unknown) => (e as { status?: number })?.status === 404;

/** Renames a library file: `{ name }`. */
export const PATCH = withRequestLog(
  'admin/pranks/sounds/[id]',
  async (req: NextRequest, ctx: RouteContext<'/api/admin/pranks/sounds/[id]'>) => {
    try {
      await requireAdmin();
      const { id } = await ctx.params;
      const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
      if (!name) return Response.json({ error: 'Give it a name' }, { status: 400 });

      const pb = await createAdminClient();
      try {
        const row = await pb.collection('prank_sounds').update(id, { name });
        return Response.json({ sound: toPrankSound(row) });
      } catch (e) {
        if (is404(e)) return notFound();
        throw e;
      }
    } catch (e) {
      return prankErrorResponse(e);
    }
  },
);

/** Removes a library file: the record first, the file second (a leftover
 *  file is harmless, a record without its file is a broken prank). Refused
 *  while an active schedule still plays it. */
export const DELETE = withRequestLog(
  'admin/pranks/sounds/[id]',
  async (_req: NextRequest, ctx: RouteContext<'/api/admin/pranks/sounds/[id]'>) => {
    try {
      await requireAdmin();
      const { id } = await ctx.params;
      const pb = await createAdminClient();

      let row;
      try {
        row = await pb.collection('prank_sounds').getOne(id);
      } catch (e) {
        if (is404(e)) return notFound();
        throw e;
      }
      const scheduled = await pb.collection('prank_schedules').getFullList({
        filter: pb.filter('sound = {:id} && active = true', { id }),
      });
      if (scheduled.length > 0) {
        return Response.json({ error: 'A repeating prank still uses it; stop that first' }, { status: 409 });
      }

      await pb.collection('prank_sounds').delete(id);
      const full = resolvePrankPath(String(row.filename ?? ''));
      if (full) {
        await fs.unlink(full).catch((e) => serverLogger.error('api', 'prank file delete failed', { id }, e));
      }
      return Response.json({ ok: true });
    } catch (e) {
      return prankErrorResponse(e);
    }
  },
);
