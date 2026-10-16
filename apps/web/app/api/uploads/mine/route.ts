import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { mapMyUpload } from '@/lib/uploads';

/** The signed-in member's own uploads, newest first, with each file's size
 *  and added date: the "Your uploads" list in Settings > Uploads. Admins get
 *  their own too, not everyone's (GET /api/uploads is the shared library). */
export const GET = withRequestLog('uploads/mine', async () => {
  try {
    const { user } = await requireUser();
    const pb = await createAdminClient();
    const rows = await pb.collection('uploads').getFullList({
      filter: pb.filter('uploader = {:uid}', { uid: user.id }),
      sort: '-created',
    });
    return Response.json({ uploads: rows.map(mapMyUpload) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
