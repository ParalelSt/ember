import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { stopSchedule } from '@/lib/pranks/settings';
import { prankErrorResponse } from '@/lib/pranks/server';

/** Stop: the repeat ends and its plays still waiting are cancelled. The
 *  row stays, inactive, so the log keeps naming it. */
export const DELETE = withRequestLog(
  'admin/pranks/schedules/[id]',
  async (_req: NextRequest, ctx: RouteContext<'/api/admin/pranks/schedules/[id]'>) => {
    try {
      await requireAdmin();
      const { id } = await ctx.params;
      const pb = await createAdminClient();
      const res = await stopSchedule(pb, id);
      if (!res) return Response.json({ error: 'No such repeat' }, { status: 404 });
      return Response.json({ ok: true, cancelled: res.cancelled });
    } catch (e) {
      return prankErrorResponse(e);
    }
  },
);
