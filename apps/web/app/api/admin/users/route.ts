import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fileUrl } from '@/lib/pocketbase/fileUrl';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { sanitizeVersion } from '@/lib/versions/label';
import { compareDevices, listDevices, newestReleases, type ComparedDevice } from '@/lib/versions/store';

export const GET = withRequestLog('admin/users', async (_req: NextRequest) => {
  try {
    await requireAdmin();
    const pb = await createAdminClient();
    const records = await pb.collection('users').getFullList({ sort: '-created' });
    const [seen, shells] = await Promise.all([listDevices(pb), newestReleases()]);
    const compared = compareDevices(seen, { shells, web: sanitizeVersion(process.env.NEXT_PUBLIC_APP_VERSION) });
    const devicesByUser = new Map<string, ComparedDevice[]>();
    for (const d of compared) {
      const list = devicesByUser.get(d.userId);
      if (list) list.push(d);
      else devicesByUser.set(d.userId, [d]);
    }
    return Response.json({
      users: records.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name ?? '',
        avatarUrl: r.avatar ? fileUrl(r, r.avatar as string) : null,
        isAdmin: r.is_admin === true,
        created: r.created,
        devices: (devicesByUser.get(r.id) ?? []).map(({ userId: _userId, ...d }) => d),
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});
