import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { memberFilesArchive, memberFilesArchiveName } from '@/lib/backups';

/** The member files that are not in the database backups (uploaded songs
 *  and covers, tabs, prank sounds; see lib/backups.ts) as one .tar.gz,
 *  built while it streams. Admin only. */
export const GET = withRequestLog('admin/backups/member-files', async () => {
  try {
    await requireAdmin();
    const body = await memberFilesArchive();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${memberFilesArchiveName()}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});
