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
import { createBackup, diskInfo, isBackupBusy, listBackups, memberFilesSummary, readSchedule } from '@/lib/backups';

/** Everything the admin Backups section shows: the backups PocketBase holds,
 *  the automatic schedule, free disk space, and the size of the member files
 *  that are not in those backups. Admin only; PocketBase is read with the
 *  superuser client. */
async function status() {
  const pb = await createAdminClient();
  const [backups, schedule, memberFiles] = await Promise.all([
    listBackups(pb),
    readSchedule(pb),
    memberFilesSummary(),
  ]);
  const largest = backups.reduce((n, b) => Math.max(n, b.size), 0);
  return { backups, schedule, disk: await diskInfo(largest), memberFiles };
}

function refusal(e: unknown): Response {
  if (e instanceof UnauthorizedError) return unauthorizedResponse();
  if (e instanceof ForbiddenError) return forbiddenResponse();
  return fromError(e);
}

export const GET = withRequestLog('admin/backups', async () => {
  try {
    await requireAdmin();
    return Response.json(await status());
  } catch (e) {
    return refusal(e);
  }
});

/** "Back up now". Waits until PocketBase has written the zip, then answers
 *  with the fresh status. PocketBase runs one backup (or restore) at a time
 *  and refuses a second one: that becomes a 409 with a plain message. */
export const POST = withRequestLog('admin/backups', async () => {
  try {
    await requireAdmin();
    const pb = await createAdminClient();
    try {
      await createBackup(pb);
    } catch (e) {
      if (isBackupBusy(e)) return jsonError('A backup is already running. Try again in a minute.', 409);
      // Anything else (a full disk, most likely) goes out as the real error,
      // and is logged.
      throw e;
    }
    return Response.json(await status());
  } catch (e) {
    return refusal(e);
  }
});
