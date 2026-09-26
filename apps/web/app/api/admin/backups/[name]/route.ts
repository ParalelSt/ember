import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { fetchBackup, isValidBackupName, listBackups } from '@/lib/backups';

/** Downloads one backup zip, streamed straight from PocketBase (they can be
 *  large, nothing is buffered here). Admin only. The name must look like a
 *  PocketBase backup name AND be in PocketBase's own list, so nothing else on
 *  the host can be reached through it. */
export const GET = withRequestLog(
  'admin/backups/[name]',
  async (_req: NextRequest, ctx: RouteContext<'/api/admin/backups/[name]'>) => {
    try {
      await requireAdmin();
      const raw = (await ctx.params).name;
      let name = raw;
      try {
        name = decodeURIComponent(raw);
      } catch {
        // Malformed escape: the check below refuses it.
      }
      if (!isValidBackupName(name)) return jsonError('Not a backup name.', 400);

      const pb = await createAdminClient();
      const known = await listBackups(pb);
      if (!known.some((b) => b.name === name)) return jsonError('No such backup.', 404);

      const upstream = await fetchBackup(pb, name);
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel().catch(() => {});
        return jsonError(`PocketBase could not send the backup (${upstream.status}).`, 502);
      }
      const headers = new Headers({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      const length = upstream.headers.get('content-length');
      if (length) headers.set('Content-Length', length);
      return new Response(upstream.body, { status: 200, headers });
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      if (e instanceof ForbiddenError) return forbiddenResponse();
      return fromError(e);
    }
  },
);
